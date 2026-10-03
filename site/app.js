// Load the real catalog and save orders in Supabase once config.js is connected.
let products = [
  {id:"whole",name:"Whole chicken",detail:"Approx. 1.5 kg · serves 3–4",price:1250,category:"whole",label:"WHOLE CHICKEN",image:"https://images.unsplash.com/photo-1587593810167-a84920ea0781?auto=format&fit=crop&w=760&q=82",alt:"Fresh whole chicken"},
  {id:"breast",name:"Chicken breast",detail:"Pack of 4 · approx. 600 g",price:950,category:"cuts",label:"BONELESS",image:"https://images.unsplash.com/photo-1604503468506-a8da13d82791?auto=format&fit=crop&w=760&q=82",alt:"Fresh chicken breast"},
  {id:"drumsticks",name:"Chicken drumsticks",detail:"Pack of 6 · approx. 800 g",price:780,category:"cuts",label:"PACK OF 6",image:"https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?auto=format&fit=crop&w=760&q=82",alt:"Chicken drumsticks"},
  {id:"mince",name:"Chicken mince",detail:"Pack of 500 g",price:650,category:"cuts",label:"READY TO COOK",image:"https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?auto=format&fit=crop&w=760&q=82",alt:"Fresh chicken mince"},
  {id:"wings",name:"Chicken wings",detail:"Pack of 1 kg · approx. 12 pieces",price:850,category:"cuts",label:"PACK OF 1 KG",image:"https://images.unsplash.com/photo-1527477396000-e27163b481c2?auto=format&fit=crop&w=760&q=82",alt:"Chicken wings"},
  {id:"family-pack",name:"Family chicken pack",detail:"Breast, thighs & drumsticks · 2 kg",price:2200,category:"packs",label:"FAMILY PACK",image:"https://images.unsplash.com/photo-1604503468506-a8da13d82791?auto=format&fit=crop&w=760&q=82",alt:"A selection of chicken cuts for a family"}
];
const money = amount => `KSh ${new Intl.NumberFormat("en-KE",{maximumFractionDigits:0}).format(amount)}`;
const $ = id => document.getElementById(id);
const config = window.GOOD_EARTH_CONFIG || {};
const connected = Boolean(window.supabase && config.supabaseUrl && config.supabasePublishableKey && !config.supabaseUrl.includes("YOUR_") && !config.supabasePublishableKey.includes("YOUR_"));
const database = connected ? window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey) : null;
let cart = JSON.parse(localStorage.getItem("good-earth-cart")||"{}");
let activeFilter="all";

function countCart(){return Object.values(cart).reduce((n,q)=>n+q,0);}
function totalCart(){return products.reduce((n,p)=>n+p.price*(cart[p.id]||0),0);}
function renderProducts(){
  const shown=products.filter(p=>activeFilter==="all"||p.category===activeFilter);
  $("productCount").textContent=`${shown.length} ${shown.length===1?"product":"products"}`;
  $("productGrid").innerHTML=shown.map(p=>`<article class="product-card"><div class="product-image"><img src="${p.image}" alt="${p.alt}" loading="lazy"><span class="product-label">${p.label}</span></div><div class="product-info"><div><h3>${p.name}</h3><p>${p.detail}</p></div><b class="price">${money(p.price)}</b></div><button class="add-button" data-add="${p.id}"><span>Add to bag</span><b>+</b></button></article>`).join("");
}
function renderCart(){
  const count=countCart(),total=totalCart();
  $("cartCount").textContent=count;$("drawerCount").textContent=`(${count})`;
  $("cartEmpty").hidden=count>0;$("cartItems").hidden=count===0;$("cartFooter").hidden=count===0;
  $("cartItems").innerHTML=products.filter(p=>cart[p.id]).map(p=>`<article class="cart-line"><img src="${p.image}" alt=""><div class="cart-line-info"><h3>${p.name}</h3><p>${p.detail}</p><div class="quantity"><button data-quantity="${p.id}" data-change="-1" aria-label="Remove one">−</button><span>${cart[p.id]}</span><button data-quantity="${p.id}" data-change="1" aria-label="Add one">+</button></div></div><b>${money(p.price*cart[p.id])}</b></article>`).join("");
  $("subtotal").textContent=money(total);$("checkoutTotal").textContent=money(total);$("checkoutSummary").innerHTML=`${count} ${count===1?"item":"items"} in your bag <b>${money(total)}</b>`;
}
function persistCart(){localStorage.setItem("good-earth-cart",JSON.stringify(cart));renderCart();}
function openBag(){$("cartDrawer").classList.add("open");$("drawerBackdrop").classList.add("open");document.body.classList.add("locked");}
function closeBag(){$("cartDrawer").classList.remove("open");$("drawerBackdrop").classList.remove("open");document.body.classList.remove("locked");}
function toast(message){const box=$("toast");box.textContent=message;box.classList.add("show");setTimeout(()=>box.classList.remove("show"),2300);}
function openCheckout(){if(!countCart())return;closeBag();$("checkoutModal").classList.add("open");document.body.classList.add("locked");}
function closeCheckout(){$("checkoutModal").classList.remove("open");document.body.classList.remove("locked");}

document.addEventListener("click",e=>{
  const add=e.target.closest("[data-add]");if(add){const id=add.dataset.add;cart[id]=(cart[id]||0)+1;persistCart();toast(`${products.find(p=>p.id===id).name} added to your bag`);return;}
  const quantity=e.target.closest("[data-quantity]");if(quantity){const id=quantity.dataset.quantity;cart[id]=(cart[id]||0)+Number(quantity.dataset.change);if(cart[id]<1)delete cart[id];persistCart();return;}
  const filter=e.target.closest("[data-filter]");if(filter){activeFilter=filter.dataset.filter;document.querySelectorAll(".category").forEach(b=>b.classList.toggle("active",b===filter));renderProducts();}
});
$("cartButton").addEventListener("click",openBag);$("closeCart").addEventListener("click",closeBag);$("drawerBackdrop").addEventListener("click",closeBag);$("shopNow").addEventListener("click",closeBag);
$("checkoutTrigger").addEventListener("click",openCheckout);$("closeCheckout").addEventListener("click",closeCheckout);$("checkoutModal").addEventListener("click",e=>{if(e.target===$("checkoutModal"))closeCheckout();});
$("checkoutForm").addEventListener("submit",async e=>{
  e.preventDefault();if(!countCart())return;
  const form=new FormData(e.currentTarget),customer={name:form.get("name").trim(),email:form.get("email").trim(),phone:form.get("phone").trim(),address:form.get("address").trim(),town:form.get("town").trim(),delivery_day:form.get("delivery_day")};
  const button=$("placeOrder"),original=button.innerHTML;button.disabled=true;button.textContent="Placing your order…";
  try{
    let orderId=`GE-${Date.now().toString().slice(-7)}`,emailSent=false;
    if(database){
      const {data,error}=await database.functions.invoke("create-order",{body:{customer,items:products.filter(p=>cart[p.id]).map(p=>({product_id:p.id,quantity:cart[p.id]}))}});
      if(error)throw new Error(error.message||"The order could not be saved.");
      orderId=data.order_id;emailSent=data.email_sent===true;
    }else{
      const order={customer,items:products.filter(p=>cart[p.id]).map(p=>({id:p.id,name:p.name,quantity:cart[p.id],unit_price_ksh:p.price})),total_ksh:totalCart(),order_id:orderId,created_at:new Date().toISOString()};
      const orders=JSON.parse(localStorage.getItem("good-earth-orders")||"[]");orders.push(order);localStorage.setItem("good-earth-orders",JSON.stringify(orders));
    }
    $("orderNumber").textContent=`Order reference: ${orderId}`;
    $("successMessage").textContent=database?(emailSent?"Your order is saved. A confirmation email is on its way; we’ll call you to confirm delivery.":"Your order is saved in Supabase. We’ll call you to confirm delivery; email confirmations are not set up yet."):"This demo order is saved in this browser only. Connect Supabase to save it online.";
    $("checkoutFormView").hidden=true;$("successView").hidden=false;cart={};persistCart();
  }catch(error){toast(error.message||"We couldn’t place that order. Please try again.");}
  finally{button.disabled=false;button.innerHTML=original;}
});
$("doneButton").addEventListener("click",()=>{closeCheckout();setTimeout(()=>{$("checkoutFormView").hidden=false;$("successView").hidden=true;$("checkoutForm").reset();},250);});
async function loadProducts(){
  if(database){
    const {data,error}=await database.from("products").select("id,name,detail,price_ksh,tag,category,image_url,image_alt").eq("active",true).order("name");
    if(!error&&data?.length)products=data.map(p=>({id:p.id,name:p.name,detail:p.detail,price:p.price_ksh,label:p.tag,category:p.category,image:p.image_url,alt:p.image_alt}));
    else if(error)toast("Could not load the live menu. Showing the sample menu.");
  }
  renderProducts();renderCart();
}
loadProducts();
