import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import type { Session, User } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { supabase } from "./lib/supabase";

type Product = {
  id: string;
  name: string;
  detail: string;
  price_ksh: number;
  tag: string;
  category: string;
  image_url: string;
  image_alt: string;
};
type Bag = Record<string, number>;
type Customer = { name: string; email: string; phone: string; address: string; town: string; delivery_day: string };
const GUEST_BAG_KEY = "good-earth-cart";
const money = (amount: number) => `KSh ${new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 }).format(amount)}`;
const cleanBag = (bag: Bag): Bag => Object.fromEntries(Object.entries(bag).map(([id, quantity]) => [id, Math.max(0, Math.min(30, Math.floor(Number(quantity) || 0)))] as const).filter(([, quantity]) => quantity > 0));
const readGuestBag = async (): Promise<Bag> => {
  try { return cleanBag(JSON.parse((await AsyncStorage.getItem(GUEST_BAG_KEY)) || "{}")); } catch { return {}; }
};

export default function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [bag, setBag] = useState<Bag>({});
  const bagRef = useRef<Bag>({});
  const userRef = useRef<User | null>(null);
  const sharedBagReadyRef = useRef(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const userGenerationRef = useRef(0);
  const [user, setUser] = useState<User | null>(null);
  const [screen, setScreen] = useState<"shop" | "bag">("shop");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [bagSyncing, setBagSyncing] = useState(false);
  const [sharedCartUnavailable, setSharedCartUnavailable] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [customer, setCustomer] = useState<Customer>({ name: "", email: "", phone: "", address: "", town: "", delivery_day: "Tomorrow" });
  const [message, setMessage] = useState("");
  const [orderReference, setOrderReference] = useState("");

  const itemCount = Object.values(bag).reduce((sum, quantity) => sum + quantity, 0);
  const total = products.reduce((sum, product) => sum + product.price_ksh * (bag[product.id] || 0), 0);
  const bagProducts = useMemo(() => products.filter(product => bag[product.id] > 0), [products, bag]);

  const publishBag = useCallback((next: Bag) => {
    const normalized = cleanBag(next);
    bagRef.current = normalized;
    setBag(normalized);
  }, []);

  const refreshSharedBag = useCallback(async (ownerId: string) => {
    const { data, error } = await supabase.from("shopping_cart_items").select("product_id,quantity").eq("user_id", ownerId).gt("quantity", 0);
    if (error) throw error;
    if (userRef.current?.id !== ownerId) return;
    publishBag(Object.fromEntries((data || []).map(row => [row.product_id, row.quantity])));
  }, [publishBag]);

  const changeBag = useCallback(async (next: Bag) => {
    const previous = bagRef.current;
    const normalized = cleanBag(next);
    publishBag(normalized);
    const ownerId = userRef.current?.id;
    if (!ownerId || !sharedBagReadyRef.current) {
      await AsyncStorage.setItem(GUEST_BAG_KEY, JSON.stringify(normalized));
      return;
    }
    const ids = new Set([...Object.keys(previous), ...Object.keys(normalized)]);
    const rows = [...ids].map(product_id => ({ user_id: ownerId, product_id, quantity: normalized[product_id] || 0 }));
    if (!rows.length) return;
    const { error } = await supabase.from("shopping_cart_items").upsert(rows, { onConflict: "user_id,product_id" });
    if (error) {
      Alert.alert("Bag not saved", "Check your connection and try again. Your last shared bag is being restored.");
      try { await refreshSharedBag(ownerId); } catch { /* Keep the last visible bag if refresh is also unavailable. */ }
    }
  }, [publishBag, refreshSharedBag]);

  const applyUser = useCallback(async (nextUser: User | null) => {
    if (userRef.current?.id === nextUser?.id) return;
    const request = ++userGenerationRef.current;
    if (channelRef.current) {
      await supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    if (request !== userGenerationRef.current) return;
    userRef.current = nextUser;
    setUser(nextUser);
    if (!nextUser) {
      sharedBagReadyRef.current = false;
      setSharedCartUnavailable(false);
      setBagSyncing(false);
      const guestBag = await readGuestBag();
      if (request === userGenerationRef.current) publishBag(guestBag);
      return;
    }

    sharedBagReadyRef.current = false;
    setBagSyncing(true);
    try {
      const guestBag = await readGuestBag();
      if (request !== userGenerationRef.current) return;
      const { data, error } = await supabase.from("shopping_cart_items").select("product_id,quantity").eq("user_id", nextUser.id).gt("quantity", 0);
      if (error) throw error;
      if (request !== userGenerationRef.current) return;
      const merged: Bag = Object.fromEntries((data || []).map(row => [row.product_id, row.quantity]));
      for (const [productId, quantity] of Object.entries(guestBag)) merged[productId] = Math.min(30, (merged[productId] || 0) + quantity);
      const rows = Object.entries(merged).map(([product_id, quantity]) => ({ user_id: nextUser.id, product_id, quantity }));
      if (rows.length) {
        const { error: saveError } = await supabase.from("shopping_cart_items").upsert(rows, { onConflict: "user_id,product_id" });
        if (saveError) throw saveError;
      }
      if (request !== userGenerationRef.current) return;
      await AsyncStorage.removeItem(GUEST_BAG_KEY);
      sharedBagReadyRef.current = true;
      setSharedCartUnavailable(false);
      publishBag(merged);
      channelRef.current = supabase.channel(`good-earth-cart-${nextUser.id}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "shopping_cart_items", filter: `user_id=eq.${nextUser.id}` }, () => {
          refreshSharedBag(nextUser.id).catch(() => setMessage("Bag sync paused. It will refresh when the connection returns."));
        })
        .subscribe(status => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setMessage("Bag sync paused. It will refresh when the connection returns.");
        });
    } catch (error) {
      if (request !== userGenerationRef.current) return;
      sharedBagReadyRef.current = false;
      setSharedCartUnavailable(true);
      setMessage(error instanceof Error ? error.message : "Your bag could not sync yet.");
      publishBag(await readGuestBag());
    } finally {
      if (request === userGenerationRef.current) setBagSyncing(false);
    }
  }, [publishBag, refreshSharedBag]);

  useEffect(() => {
    let mounted = true;
    supabase.from("products").select("id,name,detail,price_ksh,tag,category,image_url,image_alt").eq("active", true).order("name")
      .then(({ data, error }) => {
        if (!mounted) return;
        if (error) setMessage("We could not load the menu. Check your connection and try again.");
        else setProducts((data || []) as Product[]);
      }).finally(() => { if (mounted) setLoading(false); });
    readGuestBag().then(async guestBag => {
      if (!mounted) return;
      publishBag(guestBag);
      const { data } = await supabase.auth.getSession();
      if (mounted) applyUser(data.session?.user || null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session: Session | null) => {
      setTimeout(() => { if (mounted) applyUser(session?.user || null); }, 0);
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [applyUser, publishBag]);

  async function signIn() {
    setBusy(true);
    setMessage("");
    try {
      const redirectTo = Linking.createURL("auth/callback", { scheme: "thegoodearth" });
      const { data, error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo, skipBrowserRedirect: true } });
      if (error) throw error;
      if (!data.url) throw new Error("Google sign-in did not return a login link.");
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type !== "success") return;
      const code = Linking.parse(result.url).queryParams?.code;
      if (typeof code !== "string") throw new Error("Google did not return a sign-in code. Please try again.");
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
      if (exchangeError) throw exchangeError;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Google sign-in did not finish. Please try again.");
    } finally { setBusy(false); }
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) setMessage(error.message);
    else setScreen("shop");
  }

  async function placeOrder() {
    if (!itemCount) return;
    if (!customer.name.trim() || !customer.email.trim() || !customer.phone.trim() || !customer.address.trim() || !customer.town.trim() || !customer.delivery_day.trim()) {
      Alert.alert("A few details are missing", "Please enter your name, email, phone, delivery address, and town.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const items = products.filter(product => bag[product.id] > 0).map(product => ({ product_id: product.id, quantity: bag[product.id] }));
      const { data, error } = await supabase.functions.invoke("create-order", { body: { customer, items } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setOrderReference(data.order_id);
      setCheckoutOpen(false);
      setMessage(data.email_sent ? "Order placed. A confirmation email is on its way." : "Order saved. The shop will contact you to confirm delivery.");
      await changeBag({});
      setScreen("shop");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "We could not place your order. Please try again.");
    } finally { setBusy(false); }
  }

  if (loading) return <SafeAreaView style={styles.center}><StatusBar barStyle="dark-content" /><ActivityIndicator size="large" color={stylesTokens.green} /><Text style={styles.muted}>Loading the shop…</Text></SafeAreaView>;

  return <SafeAreaView style={styles.safe}>
    <StatusBar barStyle="dark-content" backgroundColor={stylesTokens.paper} />
    <View style={styles.header}>
      <View><Text style={styles.brand}>The Good Earth</Text><Text style={styles.tagline}>Good chicken, raised right</Text></View>
      <Pressable style={styles.authButton} onPress={user ? signOut : signIn} disabled={busy}><Text style={styles.authText}>{busy ? "Please wait…" : user ? "Sign out" : "Sign in"}</Text></Pressable>
    </View>
    {user && <View style={styles.signedIn}><Text style={styles.signedInText}>{bagSyncing ? "Syncing your bag…" : sharedCartUnavailable ? "Signed in · shared bag setup is needed" : "Signed in · your bag syncs with the website"}</Text></View>}
    {message ? <Pressable style={styles.notice} onPress={() => setMessage("")}><Text style={styles.noticeText}>{message}{orderReference ? `\nOrder reference: ${orderReference}` : ""}</Text></Pressable> : null}

    {screen === "shop" ? <>
      <View style={styles.intro}><Text style={styles.kicker}>FRESH FROM THE FARM</Text><Text style={styles.title}>Shop chicken</Text><Text style={styles.muted}>Choose your cuts and packs. Add them to your bag.</Text></View>
      <FlatList data={products} keyExtractor={item => item.id} contentContainerStyle={styles.list} renderItem={({ item }) => <View style={styles.productCard}>
        <Image source={{ uri: item.image_url }} accessibilityLabel={item.image_alt} style={styles.productImage} />
        <View style={styles.productCopy}><Text style={styles.productTag}>{item.tag}</Text><Text style={styles.productName}>{item.name}</Text><Text style={styles.productDetail}>{item.detail}</Text><Text style={styles.price}>{money(item.price_ksh)}</Text></View>
        <Pressable style={[styles.addButton, bagSyncing && styles.disabled]} disabled={bagSyncing} onPress={() => changeBag({ ...bagRef.current, [item.id]: Math.min(30, (bagRef.current[item.id] || 0) + 1) })}><Text style={styles.addButtonText}>Add</Text></Pressable>
      </View>} ListEmptyComponent={<Text style={styles.muted}>The shop menu is not available right now.</Text>} />
      <Pressable style={styles.bagBar} onPress={() => setScreen("bag")}><Text style={styles.bagBarText}>Your bag · {itemCount} {itemCount === 1 ? "item" : "items"}</Text><Text style={styles.bagBarText}>{money(total)}  →</Text></Pressable>
    </> : <>
      <View style={styles.bagHeading}><Pressable onPress={() => { setScreen("shop"); setCheckoutOpen(false); }}><Text style={styles.backText}>‹  Shop</Text></Pressable><Text style={styles.title}>Your bag</Text><Text style={styles.muted}>{user ? sharedCartUnavailable ? "Shared bag setup is needed before this bag can sync" : "Synced with your website account" : "Sign in on both devices to sync bags"}</Text></View>
      <ScrollView contentContainerStyle={styles.bagContent} keyboardShouldPersistTaps="handled">
        {bagProducts.length === 0 ? <View style={styles.empty}><Text style={styles.emptyTitle}>Your bag is empty</Text><Text style={styles.muted}>Add some fresh chicken to get started.</Text><Pressable style={styles.primaryButton} onPress={() => setScreen("shop")}><Text style={styles.primaryButtonText}>Browse chicken</Text></Pressable></View> : bagProducts.map(product => <View key={product.id} style={styles.bagRow}>
          <Image source={{ uri: product.image_url }} style={styles.bagImage} /><View style={styles.bagInfo}><Text style={styles.productName}>{product.name}</Text><Text style={styles.productDetail}>{money(product.price_ksh)} each</Text><View style={styles.quantity}><Pressable style={styles.quantityButton} disabled={bagSyncing} onPress={() => changeBag({ ...bagRef.current, [product.id]: Math.max(0, (bagRef.current[product.id] || 0) - 1) })}><Text style={styles.quantityText}>−</Text></Pressable><Text style={styles.quantityCount}>{bag[product.id]}</Text><Pressable style={styles.quantityButton} disabled={bagSyncing} onPress={() => changeBag({ ...bagRef.current, [product.id]: Math.min(30, (bagRef.current[product.id] || 0) + 1) })}><Text style={styles.quantityText}>+</Text></Pressable></View></View><Text style={styles.lineTotal}>{money(product.price_ksh * bag[product.id])}</Text>
        </View>)}
        {bagProducts.length > 0 && <>
          <View style={styles.totalRow}><Text style={styles.totalLabel}>Subtotal</Text><Text style={styles.totalValue}>{money(total)}</Text></View>
          <Text style={styles.deliveryNote}>Delivery fee is confirmed when we call you. Pay on delivery.</Text>
          {!checkoutOpen ? <Pressable style={styles.primaryButton} onPress={() => { setCustomer(previous => ({ ...previous, name: previous.name || user?.user_metadata?.full_name || user?.user_metadata?.name || "", email: previous.email || user?.email || "" })); setCheckoutOpen(true); }}><Text style={styles.primaryButtonText}>Continue to checkout</Text></Pressable> : <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <Text style={styles.checkoutTitle}>Delivery details</Text>
            {([ ["name","Full name"], ["email","Email address"], ["phone","Phone number"], ["address","Delivery address"], ["town","Town or area"] ] as const).map(([field, label]) => <TextInput key={field} style={styles.input} placeholder={label} value={customer[field]} onChangeText={value => setCustomer(previous => ({ ...previous, [field]: value }))} keyboardType={field === "email" ? "email-address" : field === "phone" ? "phone-pad" : "default"} autoCapitalize={field === "email" ? "none" : "sentences"} />)}
            <Text style={styles.choiceLabel}>When do you need it?</Text><View style={styles.deliveryChoices}>{["Tomorrow", "Within 2–3 days", "Please call me"].map(day => <Pressable key={day} style={[styles.deliveryChoice, customer.delivery_day === day && styles.deliveryChoiceActive]} onPress={() => setCustomer(previous => ({ ...previous, delivery_day: day }))}><Text style={[styles.deliveryChoiceText, customer.delivery_day === day && styles.deliveryChoiceTextActive]}>{day}</Text></Pressable>)}</View>
            <Pressable style={[styles.primaryButton, busy && styles.disabled]} disabled={busy} onPress={placeOrder}><Text style={styles.primaryButtonText}>{busy ? "Placing order…" : `Place order · ${money(total)}`}</Text></Pressable>
          </KeyboardAvoidingView>}
        </>}
      </ScrollView>
    </>}
  </SafeAreaView>;
}

const stylesTokens = { green: "#31543c", darkGreen: "#24422e", paper: "#ffffff", bg: "#f7f7f2", ink: "#26362b", muted: "#72796f", line: "#e3e6dd", sand: "#ebece2", clay: "#bf7953" };
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: stylesTokens.bg }, center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: stylesTokens.bg },
  header: { minHeight: 70, paddingHorizontal: 18, backgroundColor: stylesTokens.paper, borderBottomWidth: 1, borderBottomColor: stylesTokens.line, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brand: { color: stylesTokens.ink, fontSize: 18, fontWeight: "800" }, tagline: { color: stylesTokens.muted, fontSize: 11, marginTop: 2 }, authButton: { paddingVertical: 9, paddingHorizontal: 13, borderWidth: 1, borderColor: "#cbd3c6", borderRadius: 7 }, authText: { color: stylesTokens.darkGreen, fontWeight: "700", fontSize: 12 },
  signedIn: { paddingVertical: 8, paddingHorizontal: 18, backgroundColor: "#e8eee4" }, signedInText: { fontSize: 11, color: stylesTokens.darkGreen }, notice: { padding: 12, backgroundColor: "#f3e8d9", marginHorizontal: 14, marginTop: 10, borderRadius: 7 }, noticeText: { color: stylesTokens.ink, fontSize: 12, lineHeight: 18 },
  intro: { paddingHorizontal: 18, paddingTop: 24, paddingBottom: 14 }, kicker: { color: stylesTokens.green, fontSize: 10, letterSpacing: 1.2, fontWeight: "800" }, title: { fontSize: 28, color: stylesTokens.ink, fontWeight: "600", marginTop: 5 }, muted: { color: stylesTokens.muted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  list: { paddingHorizontal: 14, paddingBottom: 110, gap: 10 }, productCard: { backgroundColor: stylesTokens.paper, borderColor: stylesTokens.line, borderWidth: 1, borderRadius: 10, padding: 10, flexDirection: "row", alignItems: "center", minHeight: 120, gap: 11 }, productImage: { width: 96, height: 96, borderRadius: 7, backgroundColor: stylesTokens.sand }, productCopy: { flex: 1 }, productTag: { color: stylesTokens.clay, fontWeight: "800", letterSpacing: 0.6, fontSize: 9 }, productName: { color: stylesTokens.ink, fontSize: 14, fontWeight: "700", marginTop: 3 }, productDetail: { color: stylesTokens.muted, fontSize: 10, marginTop: 4 }, price: { color: stylesTokens.darkGreen, fontSize: 14, fontWeight: "800", marginTop: 7 }, addButton: { backgroundColor: stylesTokens.green, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 6 }, addButtonText: { color: "white", fontWeight: "700", fontSize: 12 },
  bagBar: { position: "absolute", left: 14, right: 14, bottom: 12, minHeight: 52, backgroundColor: stylesTokens.green, paddingHorizontal: 16, borderRadius: 9, flexDirection: "row", alignItems: "center", justifyContent: "space-between", elevation: 3 }, bagBarText: { color: "white", fontSize: 13, fontWeight: "800" }, bagHeading: { paddingHorizontal: 18, paddingVertical: 18 }, backText: { color: stylesTokens.green, fontWeight: "700", marginBottom: 6 }, bagContent: { paddingHorizontal: 14, paddingBottom: 32 }, empty: { minHeight: 270, alignItems: "center", justifyContent: "center" }, emptyTitle: { fontSize: 22, color: stylesTokens.ink, fontWeight: "600" },
  bagRow: { flexDirection: "row", gap: 10, alignItems: "center", paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: stylesTokens.line }, bagImage: { width: 66, height: 66, borderRadius: 6, backgroundColor: stylesTokens.sand }, bagInfo: { flex: 1 }, quantity: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 8 }, quantityButton: { width: 28, height: 28, borderWidth: 1, borderColor: stylesTokens.line, borderRadius: 5, alignItems: "center", justifyContent: "center", backgroundColor: "white" }, quantityText: { color: stylesTokens.green, fontSize: 17, fontWeight: "700" }, quantityCount: { color: stylesTokens.ink, fontWeight: "700" }, lineTotal: { color: stylesTokens.darkGreen, fontSize: 12, fontWeight: "800" },
  totalRow: { borderTopWidth: 1, borderTopColor: stylesTokens.line, paddingTop: 15, marginTop: 8, flexDirection: "row", justifyContent: "space-between" }, totalLabel: { color: stylesTokens.ink, fontSize: 14 }, totalValue: { color: stylesTokens.darkGreen, fontSize: 16, fontWeight: "800" }, deliveryNote: { color: stylesTokens.muted, fontSize: 11, marginVertical: 12 }, primaryButton: { backgroundColor: stylesTokens.green, borderRadius: 7, padding: 14, alignItems: "center", marginTop: 7 }, primaryButtonText: { color: "white", fontSize: 13, fontWeight: "800" }, checkoutTitle: { color: stylesTokens.ink, fontSize: 18, fontWeight: "700", marginTop: 22, marginBottom: 8 }, input: { backgroundColor: "white", borderColor: stylesTokens.line, borderWidth: 1, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 11, fontSize: 13, color: stylesTokens.ink, marginVertical: 4 }, choiceLabel: { color: stylesTokens.ink, fontSize: 12, fontWeight: "700", marginTop: 11, marginBottom: 6 }, deliveryChoices: { flexDirection: "row", flexWrap: "wrap", gap: 6 }, deliveryChoice: { borderWidth: 1, borderColor: stylesTokens.line, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: "white" }, deliveryChoiceActive: { backgroundColor: stylesTokens.green, borderColor: stylesTokens.green }, deliveryChoiceText: { color: stylesTokens.ink, fontSize: 10 }, deliveryChoiceTextActive: { color: "white", fontWeight: "700" }, disabled: { opacity: 0.65 },
});
