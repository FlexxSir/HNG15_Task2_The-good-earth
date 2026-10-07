// A signed-in customer's bag lives in Supabase and syncs with the mobile app.
// Visitors who are not signed in keep a separate bag in this browser.
(() => {
  const STORAGE_KEY = "good-earth-cart";
  const clamp = value => Math.max(0, Math.min(30, Math.floor(Number(value) || 0)));

  function readGuestCart() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return Object.fromEntries(Object.entries(saved).map(([id, quantity]) => [id, clamp(quantity)]).filter(([, quantity]) => quantity > 0));
    } catch {
      return {};
    }
  }

  function create(database, { onChange = () => {}, onError = () => {} } = {}) {
    let cart = readGuestCart();
    let mode = "guest";
    let userId = null;
    let channel = null;
    let authSubscription = null;
    let generation = 0;
    let writeQueue = Promise.resolve();

    function publish() { onChange({ ...cart }, mode); }
    function clean(value) {
      return Object.fromEntries(Object.entries(value || {}).map(([id, quantity]) => [id, clamp(quantity)]).filter(([, quantity]) => quantity > 0));
    }
    function storeGuest(value) {
      cart = clean(value);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
      publish();
    }
    async function fetchRemote(ownerId) {
      const { data, error } = await database.from("shopping_cart_items").select("product_id,quantity").eq("user_id", ownerId).gt("quantity", 0);
      if (error) throw error;
      return Object.fromEntries((data || []).map(item => [item.product_id, clamp(item.quantity)]).filter(([, quantity]) => quantity > 0));
    }
    async function refreshRemote(ownerId, requestId = generation) {
      try {
        const latest = await fetchRemote(ownerId);
        if (requestId !== generation || ownerId !== userId) return;
        cart = latest;
        publish();
      } catch {
        if (requestId === generation) onError("Your shared bag could not refresh. Check your connection and try again.");
      }
    }
    function stopChannel() {
      if (channel && database) database.removeChannel(channel);
      channel = null;
    }
    async function setUser(user) {
      const nextUserId = user?.id || null;
      if (nextUserId === userId && (mode === "remote" || mode === "syncing")) return;
      const requestId = ++generation;
      stopChannel();
      userId = nextUserId;
      if (!nextUserId || !database) {
        mode = "guest";
        cart = readGuestCart();
        publish();
        return;
      }

      mode = "syncing";
      publish();
      try {
        const guestCart = readGuestCart();
        const remoteCart = await fetchRemote(nextUserId);
        if (requestId !== generation) return;
        const merged = { ...remoteCart };
        for (const [productId, quantity] of Object.entries(guestCart)) {
          merged[productId] = Math.min(30, (merged[productId] || 0) + quantity);
        }
        const rows = Object.entries(merged).map(([product_id, quantity]) => ({ user_id: nextUserId, product_id, quantity }));
        if (rows.length) {
          const { error } = await database.from("shopping_cart_items").upsert(rows, { onConflict: "user_id,product_id" });
          if (error) throw error;
        }
        if (requestId !== generation) return;
        cart = merged;
        localStorage.removeItem(STORAGE_KEY);
        mode = "remote";
        channel = database.channel(`good-earth-cart-${nextUserId}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "shopping_cart_items", filter: `user_id=eq.${nextUserId}` }, () => refreshRemote(nextUserId, requestId))
          .subscribe(status => {
            if ((status === "CHANNEL_ERROR" || status === "TIMED_OUT") && requestId === generation) {
              onError("Live bag updates are reconnecting. The bag will refresh when the connection returns.");
            }
          });
        publish();
      } catch (error) {
        if (requestId !== generation) return;
        userId = null;
        mode = "guest";
        cart = guestCartFallback();
        publish();
        onError(error?.message || "We could not sync your bag yet. Please try again.");
      }
    }
    function guestCartFallback() { return readGuestCart(); }
    function setCart(nextCart) {
      const previous = cart;
      const next = clean(nextCart);
      cart = next;
      publish();
      if (mode === "guest" || mode === "syncing" || !database || !userId) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
        return;
      }

      const ownerId = userId;
      const changedIds = new Set([...Object.keys(previous), ...Object.keys(next)]);
      const rows = [...changedIds].map(product_id => ({ user_id: ownerId, product_id, quantity: next[product_id] || 0 }));
      if (!rows.length) return;
      writeQueue = writeQueue.then(async () => {
        if (ownerId !== userId) return;
        const { error } = await database.from("shopping_cart_items").upsert(rows, { onConflict: "user_id,product_id" });
        if (error) throw error;
      }).catch(error => {
        onError(error?.message || "Your bag could not be saved. Check your connection and try again.");
        return refreshRemote(ownerId);
      });
    }
    function start() {
      if (!database) return { data: { subscription: null } };
      const { data } = database.auth.onAuthStateChange((_event, session) => {
        setTimeout(() => setUser(session?.user || null), 0);
      });
      authSubscription = data.subscription;
      database.auth.getSession().then(({ data: sessionData }) => setUser(sessionData.session?.user || null));
      return { data };
    }
    function stop() {
      generation += 1;
      stopChannel();
      authSubscription?.unsubscribe();
      authSubscription = null;
    }
    return { getCart: () => ({ ...cart }), getMode: () => mode, setCart, setUser, start, stop };
  }

  window.GoodEarthCartSync = { create };
})();
