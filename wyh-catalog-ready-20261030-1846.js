// W.Y.H. product admin. Requires DB, ADMIN_PASSWORD secret; optional IMAGES R2 binding.
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','Access-Control-Allow-Origin':'https://hobbigo.github.io'}});
async function auth(req,env){
 if(!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length<20)return false;
 let value='';try{value=atob((req.headers.get('Authorization')||'').replace(/^Basic /,''));}catch{return false;}
 const expected='admin:'+env.ADMIN_PASSWORD;
 const a=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
 const b=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(expected)));
 let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;
}
async function csrfToken(env, hour = Math.floor(Date.now()/3600000)) {
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.ADMIN_PASSWORD),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('wyh-admin-form:'+hour)));
 return hour+'.'+Array.from(signature,b=>b.toString(16).padStart(2,'0')).join('');
}
async function validCsrf(value,env){
 const hour=Math.floor(Date.now()/3600000);
 for(const h of [hour,hour-1]){
  const expected=await csrfToken(env,h);if(value.length!==expected.length)continue;
  let diff=0;for(let i=0;i<value.length;i++)diff|=value.charCodeAt(i)^expected.charCodeAt(i);
  if(diff===0)return true;
 }
 return false;
}
const html=(body)=>new Response(`<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>W.Y.H. Admin</title><style>body{font:16px system-ui;background:#21150f;color:#f5ece0;max-width:1000px;margin:30px auto;padding:20px}input,textarea,button{font:inherit;padding:10px;box-sizing:border-box}label{display:block;margin:16px 0}input:not([type=checkbox]),textarea{display:block;width:100%;margin-top:6px}button,a{color:#d5b367}button{background:#35251b;border:1px solid #d5b367;cursor:pointer}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:12px;border-bottom:1px solid #69503b}img{max-width:180px}small{color:#c4ad96}.scroll{overflow:auto}</style><h1>W.Y.H. · Admin</h1><p>Pembayaran belum aktif. Permintaan pesanan perlu diperiksa admin.</p><p><a href="/admin">Produk</a> · <a href="/admin/orders">Pesanan</a> · <a href="/admin/settings">Kontak toko</a></p>${body}</html>`,{headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",'Referrer-Policy':'no-referrer'}});
// Read-only currency estimates. No product, order or payment values are written.
let adminRateCache=null;
let adminRatePending=null;
function usableAdminRates(q){return q&&q.base_code==='IDR'&&q.result==='success'&&Number.isFinite(q.time_last_update_unix)&&q.time_last_update_unix*1000<=Date.now()+300000&&Date.now()-q.time_last_update_unix*1000<48*3600000&&['USD','EUR'].every(k=>Number.isFinite(q.rates?.[k])&&q.rates[k]>0);}
async function adminRates(){
 if(usableAdminRates(adminRateCache)&&Date.now()-adminRateCache.time_last_update_unix*1000<24*3600000)return adminRateCache;
 if(adminRatePending)return adminRatePending;
 adminRatePending=(async()=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);try{const r=await fetch('https://open.er-api.com/v6/latest/IDR',{signal:controller.signal,headers:{Accept:'application/json'}});if(!r.ok)throw Error('Rates unavailable');const q=await r.json();if(!usableAdminRates(q))throw Error('Invalid rates');adminRateCache=q;return q;}catch{return usableAdminRates(adminRateCache)?adminRateCache:null;}finally{clearTimeout(timer);adminRatePending=null;}})();
 return adminRatePending;
}
function parseShippingIDR(raw){const text=String(raw).trim().replace(/^Rp\s*/i,'');let digits;if(/^\d{1,12}(?:,00)?$/.test(text))digits=text.split(',')[0];else if(/^\d{1,3}(?:\.\d{3}){1,3}(?:,00)?$/.test(text))digits=text.split(',')[0].replace(/\./g,'');else return null;const value=Number(digits);return Number.isSafeInteger(value)&&value>=0&&value<=999999999999?value:null;}
function adminMoney(value,currency='IDR',rate=1){if(!Number.isSafeInteger(value)||value<0||!Number.isFinite(rate)||rate<=0)return '—';const n=value*rate;if(!Number.isFinite(n))return '—';return currency==='IDR'?'Rp'+new Intl.NumberFormat('id-ID',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n):(currency==='USD'?'US$':'€')+new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n);}
function shippingCurrencySummary(order,rates){
 const rows=[['Subtotal produk',order.subtotal_idr],['Ongkir',order.shipping_idr],['Total pesanan',order.total_idr]];
 const pending='Belum dikonfirmasi';
 const table='<div class="scroll"><table style="min-width:640px"><tr><th>Rincian</th><th>Harga IDR</th><th>Estimasi US$</th><th>Estimasi €</th></tr>'+rows.map(([label,value])=>'<tr><td>'+esc(label)+'</td><td style="white-space:nowrap"><strong>'+esc(value==null?pending:adminMoney(value))+'</strong></td><td style="white-space:nowrap">'+esc(value==null||!rates?'—':adminMoney(value,'USD',rates.rates.USD))+'</td><td style="white-space:nowrap">'+esc(value==null||!rates?'—':adminMoney(value,'EUR',rates.rates.EUR))+'</td></tr>').join('')+'</table></div>';
 const time=rates?new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'}).format(new Date(rates.time_last_update_unix*1000))+' WIB':'';
 return table+'<p><small>USD/EUR hanya estimasi. Nilai dasar pesanan tetap IDR.</small></p><p><small>'+(rates?'Kurs harian terakhir:</small> <small>'+esc(time):'Kurs tidak tersedia. Estimasi USD/EUR tidak ditampilkan.')+'</small> · <a href="https://www.exchangerate-api.com" target="_blank" rel="noopener noreferrer">ExchangeRate-API</a></p>';
}
const baseWorker = {async fetch(req,env){
 const u=new URL(req.url),path=u.pathname;
 try{
 if(path==='/'||path==='/health'){await env.DB.prepare('SELECT 1').first();return reply({service:'wyh-api',database:'connected',checkout_enabled:false,payments_enabled:false});}
 if(path.startsWith('/images/')&&req.method==='GET'){
  if(!env.IMAGES)return reply({error:'Image storage not configured'},503);
  const key=path.slice(8);if(!/^[a-f0-9-]+\.(jpg|png|webp)$/.test(key))return reply({error:'Not found'},404);
  const item=await env.IMAGES.get(key);if(!item)return reply({error:'Not found'},404);
  return new Response(item.body,{headers:{'Content-Type':item.httpMetadata?.contentType||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'public,max-age=86400'}});
 }
 if(path==='/variants'&&req.method==='GET'){
 const id=u.searchParams.get('product_id')||'';
 if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))return reply({error:'Invalid product'},400);
 const p=await env.DB.prepare('SELECT id FROM products WHERE id=? AND active=1').bind(id).first();
 if(!p)return reply({error:'Not found'},404);
 const r=await env.DB.prepare('SELECT size,stock FROM product_variants WHERE product_id=? ORDER BY size LIMIT 100').bind(id).all();
 return reply({product_id:id,variants:r.results,stock_scope:'size_total_across_colors',checkout_enabled:false});
 }
 if(path==='/products'&&req.method==='GET'){
  const r=await env.DB.prepare('SELECT p.id,p.name,p.price_idr,p.stock,c.description,c.image_key FROM products p LEFT JOIN product_content c ON c.product_id=p.id WHERE p.active=1 AND p.price_idr>0 ORDER BY p.name LIMIT 100').all();return reply({products:r.results,limit:100,checkout_enabled:false});
 }
 if(!path.startsWith('/admin'))return reply({error:'Not found'},404);
 if(!env.ADMIN_PASSWORD||env.ADMIN_PASSWORD.length<20)return reply({error:'Admin locked. Configure ADMIN_PASSWORD secret with at least 20 characters.'},503);
 if(!await auth(req,env))return new Response('Login admin diperlukan',{status:401,headers:{'WWW-Authenticate':'Basic realm="WYH Admin", charset="UTF-8"','Cache-Control':'no-store'}});
 if(req.method==='POST'){
  const origin=req.headers.get('Origin');
  if(origin && origin!=='null' && origin!==u.origin)return reply({error:'Origin rejected'},403);
  const length=Number(req.headers.get('Content-Length'));if(!length||length>6000000)return reply({error:'Request too large or missing length'},413);
  const f=await req.formData();
  if(!await validCsrf(String(f.get('csrf')||''),env))return html('<p>Formulir kedaluwarsa atau tidak valid. Buka ulang halaman edit lalu simpan kembali.</p><a href="/admin">Kembali ke produk</a>');
  if(path==='/admin/save'){
   const id=String(f.get('id')||'')||'wyh-'+crypto.randomUUID();
   const name=String(f.get('name')||'').trim(),description=String(f.get('description')||'').trim();
   const rawPrice=String(f.get('price')||''),rawStock=String(f.get('stock')||'');
   const price=rawPrice===''?null:Number(rawPrice),stock=Number(rawStock);
   if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id)||!name||name.length>200||description.length>5000||!/^\d+$/.test(rawStock)||!Number.isSafeInteger(stock)||stock<0||(price!==null&&(!/^\d+$/.test(rawPrice)||!Number.isSafeInteger(price)||price<0)))return html('<p>Data tidak valid. Gunakan harga dan stok berupa angka bulat tanpa titik.</p><a href="/admin">Kembali</a>');
   const active=f.get('active')==='on'?1:0;if(active&&(!price||stock<1))return html('<p>Produk aktif perlu harga positif dan stok tersedia.</p><a href="/admin">Kembali</a>');
   let imageKey=null;const file=f.get('image');
   if(file&&typeof file!=='string'&&file.size){
    if(!env.IMAGES)return html('<p>Gambar belum disimpan. Hubungkan R2 dengan nama IMAGES dulu.</p><a href="/admin">Kembali</a>');
    if(file.size>5000000)return reply({error:'Maximum image size 5 MB'},400);
    const data=new Uint8Array(await file.arrayBuffer());
    let ext='',type='';
    if(data[0]===255&&data[1]===216&&data[2]===255){ext='jpg';type='image/jpeg';}
    else if(data[0]===137&&data[1]===80&&data[2]===78&&data[3]===71&&data[4]===13&&data[5]===10&&data[6]===26&&data[7]===10){ext='png';type='image/png';}
    else if(String.fromCharCode(...data.slice(0,4))==='RIFF'&&String.fromCharCode(...data.slice(8,12))==='WEBP'){ext='webp';type='image/webp';}
    else return reply({error:'Use JPG, PNG or WebP'},400);
    imageKey=crypto.randomUUID()+'.'+ext;await env.IMAGES.put(imageKey,data,{httpMetadata:{contentType:type}});
   }
   await env.DB.batch([
    env.DB.prepare('INSERT INTO products(id,name,price_idr,stock,active) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,price_idr=excluded.price_idr,stock=excluded.stock,active=excluded.active').bind(id,name,price,stock,active),
    env.DB.prepare('INSERT INTO product_content(product_id,description,image_key) VALUES(?,?,?) ON CONFLICT(product_id) DO UPDATE SET description=excluded.description,image_key=COALESCE(excluded.image_key,product_content.image_key)').bind(id,description,imageKey)
   ]);
   return new Response(null,{status:303,headers:{Location:'/admin?saved=1','Cache-Control':'no-store'}});
  }
  return reply({error:'Not found'},404);
 }
 if(req.method!=='GET')return reply({error:'Method not allowed'},405);
 if(path==='/admin/edit'){
  const id=u.searchParams.get('id');let p={};
  if(id){p=await env.DB.prepare('SELECT p.*,c.description,c.image_key FROM products p LEFT JOIN product_content c ON c.product_id=p.id WHERE p.id=?').bind(id).first();if(!p)return reply({error:'Not found'},404);}
  return html(`<a href="/admin">← Daftar produk</a><h2>${id?'Edit':'Tambah'} produk</h2><form method="post" action="/admin/save" enctype="multipart/form-data"><input type="hidden" name="csrf" value="${await csrfToken(env)}"><input type="hidden" name="id" value="${esc(p.id)}"><label>Nama produk<input name="name" maxlength="200" required value="${esc(p.name)}"></label><label>Deskripsi<textarea name="description" maxlength="5000">${esc(p.description)}</textarea></label><label>Harga IDR, angka tanpa titik<input type="number" name="price" min="0" step="1" value="${esc(p.price_idr)}"></label><label>Stok total model<input type="number" name="stock" required min="0" step="1" value="${esc(p.stock??0)}"></label>${p.image_key?`<img src="/images/${esc(p.image_key)}" alt="Foto produk">`:''}<label>Gambar utama JPG/PNG/WebP, maksimal 5 MB<input type="file" name="image" accept="image/jpeg,image/png,image/webp" ${env.IMAGES?'':'disabled'}></label>${env.IMAGES?'':'<p>Upload terkunci sampai penyimpanan R2 IMAGES dihubungkan.</p>'}<label><input type="checkbox" name="active" ${p.active?'checked':''}> Tampilkan di katalog API</label><p><small>Mengaktifkan produk tidak membuka checkout. Ukuran, warna dan stok per kombinasi belum dapat diedit di versi admin ini.</small></p><button>Simpan produk</button></form>`);
 }
 if(path==='/admin'||path==='/admin/'){
  const r=await env.DB.prepare('SELECT id,name,price_idr,stock,active FROM products ORDER BY name LIMIT 201').all();
  const rates=await adminRates();
  const updated=rates?new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'}).format(new Date(rates.time_last_update_unix*1000))+' WIB':'';
  return html(`${u.searchParams.has('saved')?'<p>Produk berhasil disimpan.</p>':''}<a href="/admin/edit">+ Tambah produk</a><section style="margin:18px 0;padding:14px;border:1px solid #79603f;border-radius:8px"><strong>Harga dasar: IDR</strong><p><small>Ubah harga IDR saja. USD/EUR dihitung otomatis dan tidak bisa diedit. Ini estimasi, bukan kurs pembayaran.</small></p>${rates?'<small>Kurs harian terakhir:</small> <small>'+esc(updated)+'</small>':'<small>Kurs tidak tersedia. Estimasi USD/EUR tidak ditampilkan.</small>'}<p><small><a href="https://www.exchangerate-api.com" target="_blank" rel="noopener noreferrer">ExchangeRate-API</a></small></p></section><div class="scroll"><table style="min-width:960px"><tr><th>Produk</th><th>Harga IDR</th><th>Estimasi US$</th><th>Estimasi €</th><th>Stok</th><th>Status</th><th></th></tr>${r.results.slice(0,200).map(p=>`<tr><td>${esc(p.name)}</td><td style="white-space:nowrap"><strong>${esc(p.price_idr==null?'Belum diisi':adminMoney(p.price_idr))}</strong></td><td style="color:#c4ad96;white-space:nowrap">${esc(rates?adminMoney(p.price_idr,'USD',rates.rates.USD):'—')}</td><td style="color:#c4ad96;white-space:nowrap">${esc(rates?adminMoney(p.price_idr,'EUR',rates.rates.EUR):'—')}</td><td>${esc(p.stock)}</td><td>${p.active?'Aktif':'Draf'}</td><td><a href="/admin/edit?id=${encodeURIComponent(p.id)}">Edit</a></td></tr>`).join('')}</table></div>${r.results.length>200?'<p>Menampilkan 200 produk pertama.</p>':''}<p><small>Login memakai autentikasi browser. Pada perangkat bersama, gunakan mode privat dan tutup seluruh jendela privat setelah selesai.</small></p>`);
 }
 return reply({error:'Not found'},404);
 }catch{return reply({error:'Layanan belum siap. Periksa binding DB, tabel product_content, dan konfigurasi penyimpanan.'},503);}
}};

// Order-request admin. Requests do not reserve inventory or accept payments.
function readableOrderEvent(event){
 const labels={created:'Permintaan pesanan dibuat',change_requested:'Customer mengajukan perubahan',changed:'Pesanan diperbarui',cancel_requested:'Customer mengajukan pembatalan',cancelled:'Pesanan dibatalkan',shipping_quoted:'Ongkir dan total diperbarui',confirmed:'Pesanan dikonfirmasi',payment_verified:'Pembayaran diverifikasi',completed:'Pesanan selesai'};
 const actors={customer:'Customer',admin:'Admin',system:'Sistem'};
 let details={};try{details=JSON.parse(event.details_json||'{}');}catch{}
 const rawTime=String(event.created_at||'');const date=new Date(rawTime.replace(' ','T')+'Z');
 const time=Number.isNaN(date.getTime())?rawTime:new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'}).format(date)+' WIB';
 let body='';
 if(typeof details.note==='string'&&details.note)body+='<p>Catatan: '+esc(details.note)+'</p>';
 if(Array.isArray(details.items))body+='<p>'+details.items.length+' baris produk dicatat.</p>';
 if(Number.isSafeInteger(details.subtotal_idr))body+='<p>Subtotal produk: '+esc(new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(details.subtotal_idr))+'</p>';
 if(Number.isSafeInteger(details.shipping_idr))body+='<p>Ongkir: '+esc(adminMoney(details.shipping_idr))+'</p>';
 if(Number.isSafeInteger(details.total_idr))body+='<p>Total pesanan IDR: '+esc(adminMoney(details.total_idr))+'</p>';
 if(details.previous_status)body+='<p>Status sebelumnya: '+esc(orderStates[details.previous_status]||details.previous_status)+'</p>';
 if(details.stock_reserved===false)body+='<p>Stok belum direservasi.</p>';
 return '<section style="padding:16px 0;border-bottom:1px solid #69503b"><strong>'+esc(labels[event.event_type]||'Aktivitas pesanan')+'</strong><p><small>'+esc(time)+' · '+esc(actors[event.actor_type]||'Sistem')+'</small></p>'+body+'</section>';
}
const orderStates={awaiting_confirmation:'Menunggu konfirmasi',awaiting_payment:'Menunggu pembayaran',paid:'Lunas',cancelled:'Dibatalkan',completed:'Selesai'};
function orderRedirect(id){return new Response(null,{status:303,headers:{Location:'/admin/order?id='+encodeURIComponent(id),'Cache-Control':'no-store'}});}
async function orderToken(env,id){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.ORDER_ACCESS_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const data=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('wyh-order-access:'+id)));
 return Array.from(data,b=>b.toString(16).padStart(2,'0')).join('');
}
async function tokenValid(env,id,value){if(!env.ORDER_ACCESS_SECRET||env.ORDER_ACCESS_SECRET.length<32||typeof value!=='string')return false;const expected=await orderToken(env,id);if(value.length!==expected.length)return false;let diff=0;for(let i=0;i<value.length;i++)diff|=value.charCodeAt(i)^expected.charCodeAt(i);return diff===0;}
function orderJson(data,status=200){return Response.json(data,{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'https://hobbigo.github.io','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','X-Content-Type-Options':'nosniff'}});}
async function boundedJson(req){const reader=req.body?.getReader();if(!reader)throw Error('Body required');const decoder=new TextDecoder();let text='',size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>24000){await reader.cancel();throw Error('Body too large');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();return JSON.parse(text);}
const orderWorker = {async fetch(req,env,ctx){
 const u=new URL(req.url),path=u.pathname;
 if(path==='/checkout-config'&&req.method==='GET')return orderJson({site_key:env.TURNSTILE_SITE_KEY||'',turnstile_configured:!!(env.TURNSTILE_SITE_KEY&&env.TURNSTILE_SECRET_KEY),requests_enabled:env.ACCEPT_ORDER_REQUESTS==='true',payments_enabled:false});
 if(!['/order-requests','/order-request','/order-request-action','/admin/orders','/admin/order','/admin/order-action','/admin/shipping'].includes(path))return baseWorker.fetch(req,env,ctx);
 try{
 const publicRoute=!path.startsWith('/admin');
 if(publicRoute){
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':'https://hobbigo.github.io','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Cache-Control':'no-store'}});
  if(typeof env.ORDER_ACCESS_SECRET!=='string'||!env.ORDER_ACCESS_SECRET)return orderJson({error:'Kunci pesanan belum terbaca oleh versi aktif.',code:'ORDER_ACCESS_SECRET_MISSING'},503);
  if(env.ORDER_ACCESS_SECRET.length<32)return orderJson({error:'Kunci pesanan terbaca, tetapi panjangnya belum memenuhi minimal 32 karakter.',code:'ORDER_ACCESS_SECRET_TOO_SHORT'},503);
  if(path==='/order-requests'&&req.method==='POST'){
   if(env.ACCEPT_ORDER_REQUESTS!=='true')return orderJson({error:'Pengiriman permintaan belum dibuka.'},503);
   if(req.headers.get('Origin')!=='https://hobbigo.github.io'||!req.headers.get('Content-Type')?.startsWith('application/json'))return orderJson({error:'Permintaan tidak diizinkan.'},403);
   const body=await boundedJson(req);
   if(!env.TURNSTILE_SECRET_KEY||!env.TURNSTILE_SITE_KEY)return orderJson({error:'Pemeriksaan keamanan belum dikonfigurasi.'},503);
   if(typeof body.turnstile_token!=='string'||!body.turnstile_token||body.turnstile_token.length>2048)return orderJson({error:'Selesaikan pemeriksaan keamanan lalu coba lagi.'},400);
   let verification;
   try{const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),10000);try{const r=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:env.TURNSTILE_SECRET_KEY,response:body.turnstile_token,remoteip:req.headers.get('CF-Connecting-IP')||undefined}),signal:controller.signal});if(!r.ok)throw Error();verification=await r.json();}finally{clearTimeout(timeout);}}catch{return orderJson({error:'Pemeriksaan keamanan belum dapat dihubungi. Coba lagi.'},503);}
   if(verification.success!==true||verification.hostname!=='hobbigo.github.io'||verification.action!=='wyh_order_request')return orderJson({error:'Pemeriksaan keamanan tidak valid atau kedaluwarsa. Ulangi pemeriksaan.'},403);
   const customer=body.customer||{};
   const name=String(customer.name||'').trim(),email=String(customer.email||'').trim(),phone=String(customer.phone||'').trim(),address=String(customer.address||'').trim();
   if(!name||name.length>150||!/^\S+@\S+\.\S+$/.test(email)||email.length>254||phone.length<6||phone.length>40||address.length<10||address.length>1500||!/^[-a-zA-Z0-9]{20,100}$/.test(body.idempotency_key||'')||!Array.isArray(body.items)||body.items.length<1||body.items.length>20)return orderJson({error:'Periksa nama, email, telepon, alamat dan isi keranjang.'},400);
   const existing=await env.DB.prepare('SELECT * FROM order_requests WHERE idempotency_key=?').bind(body.idempotency_key).first();
   if(existing){const oldItems=JSON.parse(existing.items_json).map(x=>({id:x.id,size:x.size,color:x.color,qty:x.qty}));const incoming=body.items.map(x=>({id:x.id,size:x.size||'',color:x.color||'',qty:x.qty}));if(existing.customer_email!==email||existing.customer_name!==name||existing.customer_phone!==phone||existing.shipping_address!==address||JSON.stringify(oldItems)!==JSON.stringify(incoming))return orderJson({error:'Permintaan sebelumnya berbeda. Muat ulang checkout.'},409);return orderJson({id:existing.id,token:await orderToken(env,existing.id),status:existing.status,replayed:true});}
   let subtotal=0;const items=[],totals=new Map();let colorMetadata=new Map();
   try{const ids=[...new Set(body.items.map(x=>x.id).filter(x=>typeof x==='string'))];if(ids.length){const r=await env.DB.prepare('SELECT product_id,category,colors_json FROM wyh_catalog_metadata WHERE product_id IN ('+ids.map(()=>'?').join(',')+')').bind(...ids).all();colorMetadata=new Map(r.results.map(x=>[x.product_id,x]));}}catch{}
   for(const line of body.items){
    if(typeof line.id!=='string'||!Number.isInteger(line.qty)||line.qty<1||line.qty>20)return orderJson({error:'Barang atau jumlah tidak valid.'},400);
    const p=await env.DB.prepare('SELECT id,name,price_idr,stock FROM products WHERE id=? AND active=1').bind(line.id).first();
    if(!p||!Number.isSafeInteger(p.price_idr)||p.price_idr<=0)return orderJson({error:'Produk tidak tersedia. Muat ulang katalog.'},409);
    const variants=await env.DB.prepare('SELECT size,stock FROM product_variants WHERE product_id=?').bind(p.id).all();
    const size=String(line.size||''),color=String(line.color||'');let available=p.stock;
    if(variants.results.length){const v=variants.results.find(x=>x.size===size);if(!v||!Number.isSafeInteger(v.stock))return orderJson({error:'Ukuran tidak tersedia untuk '+p.name},409);available=v.stock;}else if(size)return orderJson({error:'Produk ini tidak memiliki ukuran.'},400);
    const colorInfo=colorMetadata.get(p.id);const allowedColors=wyhColors(colorInfo,colorInfo?.category||wyhKnownCategories[p.id]);if(allowedColors.length&&!allowedColors.includes(color))return orderJson({error:'Pilih warna yang tersedia untuk '+p.name},400);if(!allowedColors.length&&color)return orderJson({error:'Warna tidak valid.'},400);
    const key=p.id+'|'+size;const used=(totals.get(key)||0)+line.qty;totals.set(key,used);if(!Number.isSafeInteger(available)||used>available)return orderJson({error:'Jumlah melebihi stok untuk '+p.name},409);
    subtotal+=p.price_idr*line.qty;if(!Number.isSafeInteger(subtotal))return orderJson({error:'Total tidak valid.'},400);
    items.push({id:p.id,name:p.name,size,color,qty:line.qty,unit_price_idr:p.price_idr});
   }
   const id='WYH-'+crypto.randomUUID();
   try{await env.DB.batch([
    env.DB.prepare('INSERT INTO order_requests(id,idempotency_key,customer_name,customer_email,customer_phone,shipping_address,items_json,subtotal_idr) VALUES(?,?,?,?,?,?,?,?)').bind(id,body.idempotency_key,name,email,phone,address,JSON.stringify(items),subtotal),
    env.DB.prepare('INSERT INTO order_request_events(order_request_id,event_type,actor_type,details_json) VALUES(?,?,?,?)').bind(id,'created','customer',JSON.stringify({items,subtotal_idr:subtotal,stock_reserved:false}))
   ]);}catch{return orderJson({error:'Permintaan belum dapat dipastikan tersimpan. Coba lagi dengan formulir yang sama.'},503);}
   return orderJson({id,token:await orderToken(env,id),status:'awaiting_confirmation',subtotal_idr:subtotal,stock_reserved:false,payment_requested:false},201);
  }
  if(path==='/order-request'&&req.method==='GET'){
   const id=u.searchParams.get('id')||'',token=u.searchParams.get('token')||'';if(!await tokenValid(env,id,token))return orderJson({error:'Akses tidak valid.'},403);
   const order=await env.DB.prepare('SELECT id,items_json,subtotal_idr,shipping_idr,total_idr,status,created_at FROM order_requests WHERE id=?').bind(id).first();if(!order)return orderJson({error:'Tidak ditemukan.'},404);
   return orderJson({...order,items:JSON.parse(order.items_json),items_json:undefined,payment_requested:false});
  }
  if(path==='/order-request-action'&&req.method==='POST'){
   if(req.headers.get('Origin')!=='https://hobbigo.github.io'||!req.headers.get('Content-Type')?.startsWith('application/json'))return orderJson({error:'Permintaan tidak diizinkan.'},403);
   const body=await boundedJson(req);if(!await tokenValid(env,body.id,body.token))return orderJson({error:'Akses tidak valid.'},403);
   const order=await env.DB.prepare('SELECT * FROM order_requests WHERE id=?').bind(body.id).first();if(!order)return orderJson({error:'Tidak ditemukan.'},404);
   if(!['cancel','request_change'].includes(body.action))return orderJson({error:'Aksi tidak valid.'},400);
   if(['cancelled','completed'].includes(order.status))return orderJson({error:'Permintaan sudah ditutup.'},409);
   const note=String(body.note||'').trim();if(note.length>2000)return orderJson({error:'Catatan terlalu panjang.'},400);
   // Customer requests never alter a potentially paid order automatically.
   const type=body.action==='cancel'?'cancel_requested':'change_requested';
   await env.DB.prepare('INSERT INTO order_request_events(order_request_id,event_type,actor_type,details_json) VALUES(?,?,?,?)').bind(order.id,type,'customer',JSON.stringify({note,status_at_request:order.status})).run();
   return orderJson({id:order.id,status:order.status,request_recorded:type,requires_admin_review:true});
  }
  return orderJson({error:'Not found'},404);
 }
 if(!env.ADMIN_PASSWORD||env.ADMIN_PASSWORD.length<20)return reply({error:'Admin belum dikonfigurasi.'},503);
 if(!await auth(req,env))return new Response('Login admin diperlukan',{status:401,headers:{'WWW-Authenticate':'Basic realm="WYH Admin", charset="UTF-8"','Cache-Control':'no-store'}});
 if(path==='/admin/orders'&&req.method==='GET'){
  const r=await env.DB.prepare('SELECT id,customer_name,subtotal_idr,status,created_at FROM order_requests ORDER BY created_at DESC LIMIT 101').all();
  return html(`<a href="/admin">← Admin produk</a><h2>Permintaan pesanan</h2><p>Tidak ada reservasi stok atau instruksi pembayaran otomatis. Maksimal 100 permintaan terbaru.</p><div class="scroll"><table><tr><th>Tanggal</th><th>Pelanggan</th><th>Subtotal IDR</th><th>Status</th><th></th></tr>${r.results.slice(0,100).map(o=>`<tr><td>${esc(o.created_at)}</td><td>${esc(o.customer_name)}</td><td>${esc(o.subtotal_idr)}</td><td>${esc(orderStates[o.status])}</td><td><a href="/admin/order?id=${encodeURIComponent(o.id)}">Periksa</a></td></tr>`).join('')}</table></div>${!r.results.length?'<p>Belum ada permintaan pesanan.</p>':''}`);
 }
 if(path==='/admin/order'&&req.method==='GET'){
  const order=await env.DB.prepare('SELECT * FROM order_requests WHERE id=?').bind(u.searchParams.get('id')||'').first();if(!order)return reply({error:'Not found'},404);
  const events=await env.DB.prepare('SELECT event_type,actor_type,details_json,created_at FROM order_request_events WHERE order_request_id=? ORDER BY id DESC LIMIT 100').bind(order.id).all();const items=JSON.parse(order.items_json);
  const csrf=await csrfToken(env);const quoteRates=await adminRates();
  return html(`<a href="/admin/orders">← Permintaan pesanan</a><h2>${esc(order.id)}</h2><p>Status: ${esc(orderStates[order.status])}</p><p>${esc(order.customer_name)}<br>${esc(order.customer_email)}<br>${esc(order.customer_phone)}</p><p style="white-space:pre-wrap">${esc(order.shipping_address)}</p><table><tr><th>Produk</th><th>Pilihan</th><th>Jumlah</th><th>Harga IDR</th></tr>${items.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc([x.size,x.color].filter(Boolean).join(' / '))}</td><td>${esc(x.qty)}</td><td>${esc(x.unit_price_idr)}</td></tr>`).join('')}</table><section style="margin:20px 0;padding:16px;border:1px solid #79603f;border-radius:8px"><h3>Ongkir dan total IDR</h3>${u.searchParams.has('shipping_saved')?'<p>Ongkir dan total berhasil disimpan.</p>':''}${shippingCurrencySummary(order,quoteRates)}<small>Ini rincian biaya, bukan tagihan pembayaran. Stok belum direservasi.</small>${order.status==='awaiting_confirmation'?`<form method="post" action="/admin/shipping"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="id" value="${esc(order.id)}"><label>Ongkir IDR, contoh 1.000.000,00<input type="text" inputmode="decimal" name="shipping_idr" maxlength="24" autocomplete="off" required placeholder="1.000.000,00" value="${order.shipping_idr==null?'':esc(adminMoney(order.shipping_idr).replace(/^Rp/,''))}"></label><small>Angka desimal ,00 hanya format tampilan. Ongkir disimpan sebagai rupiah bulat. Estimasi USD/EUR diperbarui setelah disimpan.</small><small>Isi 0 untuk gratis ongkir. Jangan menebak biaya; periksa tujuan dan tarif pengiriman terlebih dahulu.</small><label>Catatan ongkir<textarea name="note" maxlength="2000" placeholder="Kurir, layanan, dan perkiraan waktu kirim"></textarea></label><label><input type="checkbox" name="confirm" required> Saya telah memeriksa tujuan dan menyetujui ongkir ini.</label><button>Simpan ongkir dan total</button></form>`:'<p>Pengubahan ongkir dikunci untuk status pesanan ini.</p>'}</section><p>Rekening belum diatur. Jangan meminta transfer. Stok belum direservasi.</p>${['awaiting_confirmation','awaiting_payment'].includes(order.status)?`<form method="post" action="/admin/order-action"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="id" value="${esc(order.id)}"><label>Catatan admin<textarea name="note" required maxlength="2000"></textarea></label><label><input type="checkbox" name="confirm" required> Saya memastikan pesanan belum dibayar dan menyetujui pembatalan.</label><button name="action" value="cancel">Batalkan pesanan belum dibayar</button></form>`:''}<h3>Riwayat terbaru</h3>${events.results.map(readableOrderEvent).join('')}${await contactSupportBlock(env)}${order.status==='cancelled'?`<p><a href="/admin/cancellation-receipt?id=${encodeURIComponent(order.id)}">Cetak bukti pembatalan</a></p>`:''}`);
 }
 if(path==='/admin/shipping'&&req.method==='POST'){
  const origin=req.headers.get('Origin');if(origin&&origin!=='null'&&origin!==u.origin)return reply({error:'Origin rejected'},403);
  const length=Number(req.headers.get('Content-Length'));if(length>12000)return reply({error:'Form terlalu besar.'},413);
  const f=await req.formData();if(!await validCsrf(String(f.get('csrf')||''),env))return html('<p>Formulir kedaluwarsa. Buka ulang detail pesanan.</p>');
  const id=String(f.get('id')||''),raw=String(f.get('shipping_idr')||''),note=String(f.get('note')||'').trim();
  if(!id||id.length>100||parseShippingIDR(raw)===null||note.length>2000||f.get('confirm')!=='on')return html('<p>Periksa ongkir dalam rupiah dan centang konfirmasi. Contoh: 1000000 atau 1.000.000,00. Pecahan rupiah selain ,00 tidak diterima; 0 berarti gratis ongkir.</p><a href="/admin/orders">Kembali</a>');
  const shipping=parseShippingIDR(raw);const order=await env.DB.prepare('SELECT id,status,subtotal_idr,shipping_idr,total_idr FROM order_requests WHERE id=?').bind(id).first();
  if(!order)return reply({error:'Tidak ditemukan.'},404);
  if(order.status!=='awaiting_confirmation')return html('<p>Ongkir hanya bisa diubah saat menunggu konfirmasi. Pesanan dibayar, dibatalkan, selesai, atau sudah menunggu pembayaran tidak boleh diubah di sini.</p><a href="/admin/orders">Kembali</a>');
  const total=order.subtotal_idr+shipping;
  if(!Number.isSafeInteger(order.subtotal_idr)||order.subtotal_idr<0||!Number.isSafeInteger(shipping)||shipping<0||!Number.isSafeInteger(total))return reply({error:'Total tidak valid.'},400);
  if(order.shipping_idr===shipping&&order.total_idr===total)return new Response(null,{status:303,headers:{Location:'/admin/order?id='+encodeURIComponent(id)+'&shipping_saved=1','Cache-Control':'no-store'}});
  // Conditional batch: audit and quote change together; never changes payment status or inventory.
  const result=await env.DB.batch([
   env.DB.prepare("INSERT INTO order_request_events(order_request_id,event_type,actor_type,details_json) SELECT id,'shipping_quoted','admin',? FROM order_requests WHERE id=? AND status='awaiting_confirmation' AND subtotal_idr=? AND shipping_idr IS ? AND total_idr IS ?").bind(JSON.stringify({note,subtotal_idr:order.subtotal_idr,shipping_idr:shipping,total_idr:total,previous_shipping_idr:order.shipping_idr??null,previous_total_idr:order.total_idr??null,payment_requested:false,stock_reserved:false}),id,order.subtotal_idr,order.shipping_idr??null,order.total_idr??null),
   env.DB.prepare("UPDATE order_requests SET shipping_idr=?,total_idr=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='awaiting_confirmation' AND subtotal_idr=? AND shipping_idr IS ? AND total_idr IS ?").bind(shipping,total,id,order.subtotal_idr,order.shipping_idr??null,order.total_idr??null)
  ]);
  if(result[1]?.meta?.changes!==1)return html('<p>Pesanan berubah saat Anda menyimpan. Buka ulang detail pesanan untuk memeriksa ongkir terbaru.</p><a href="/admin/orders">Kembali</a>');
  return new Response(null,{status:303,headers:{Location:'/admin/order?id='+encodeURIComponent(id)+'&shipping_saved=1','Cache-Control':'no-store'}});
 }
 if(path==='/admin/order-action'&&req.method==='POST'){
  const origin=req.headers.get('Origin');if(origin&&origin!=='null'&&origin!==u.origin)return reply({error:'Origin rejected'},403);
  const f=await req.formData();if(!await validCsrf(String(f.get('csrf')||''),env))return html('<p>Formulir kedaluwarsa. Buka ulang detail pesanan.</p>');
  if(f.get('action')!=='cancel'||f.get('confirm')!=='on')return reply({error:'Konfirmasi diperlukan.'},400);
  const id=String(f.get('id')||''),note=String(f.get('note')||'').trim();if(!note||note.length>2000)return reply({error:'Isi catatan pembatalan.'},400);
  const order=await env.DB.prepare('SELECT status FROM order_requests WHERE id=?').bind(id).first();if(!order||!['awaiting_confirmation','awaiting_payment'].includes(order.status))return reply({error:'Status tidak mengizinkan pembatalan langsung.'},409);
  await env.DB.batch([
   env.DB.prepare("INSERT INTO order_request_events(order_request_id,event_type,actor_type,details_json) SELECT id,'cancelled','admin',? FROM order_requests WHERE id=? AND status=?").bind(JSON.stringify({note,previous_status:order.status}),id,order.status),
   env.DB.prepare("UPDATE order_requests SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status=?").bind(id,order.status)
  ]);return orderRedirect(id);
 }
 return reply({error:'Not found'},404);
 }catch{return orderJson({error:'Layanan pesanan belum siap. Periksa tabel dan konfigurasi Worker.'},503);}
}};

async function storeSettings(env){return await env.DB.prepare('SELECT store_name,contact_email,contact_phone FROM store_settings WHERE id=1').first()||{store_name:'W.Y.H.',contact_email:'',contact_phone:''};}
async function contactSupportBlock(env){const s=await storeSettings(env);return `<section style="margin-top:24px;padding-top:20px;border-top:1px solid #69503b"><h3>Bantuan ${esc(s.store_name)}</h3>${s.contact_email?`<p>Email: <a href="mailto:${esc(s.contact_email)}">${esc(s.contact_email)}</a></p>`:''}${s.contact_phone?`<p>Telepon: ${esc(s.contact_phone)}</p>`:''}${!s.contact_email&&!s.contact_phone?'<p>Kontak layanan belum diisi. <a href="/admin/settings">Isi kontak toko</a>.</p>':''}</section>`;}
async function cancellationReceipt(env,order){
 const settings=await storeSettings(env);const items=JSON.parse(order.items_json);
 const event=await env.DB.prepare("SELECT created_at,details_json FROM order_request_events WHERE order_request_id=? AND event_type='cancelled' ORDER BY id DESC LIMIT 1").bind(order.id).first();
 let note='';try{note=JSON.parse(event?.details_json||'{}').note||'';}catch{}
 const formatDate=value=>{const date=new Date(String(value).replace(' ','T')+'Z');return Number.isNaN(date.getTime())?'Belum tercatat':new Intl.DateTimeFormat('id-ID',{dateStyle:'long',timeStyle:'short',timeZone:'Asia/Jakarta'}).format(date)+' WIB';};
 const money=value=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(value);
 const nonce=crypto.randomUUID().replaceAll('-','');
 const email=String(order.customer_email||'').replace(/^(.)(.*)(@.*)$/,(_,a,b,c)=>a+'***'+c);
 const phone=String(order.customer_phone||'');const maskedPhone=phone.length>4?'***'+phone.slice(-4):'***';
 const page=`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bukti pembatalan ${esc(order.id)}</title><style>body{font:15px/1.6 Arial,sans-serif;color:#292018;background:#eee8df;margin:0;padding:24px}main{max-width:850px;background:white;margin:auto;padding:36px;box-sizing:border-box}h1{font:30px Georgia,serif;margin:0}h2{font-size:21px}table{width:100%;border-collapse:collapse}td,th{text-align:left;vertical-align:top;padding:10px 6px;border-bottom:1px solid #ddd}small{color:#665b50}.notice{padding:16px;border:1px solid #998366;margin:24px 0}.tools{max-width:850px;margin:0 auto 20px}button{padding:12px 20px;font:inherit;cursor:pointer}.meta{overflow-wrap:anywhere}@media print{body{background:white;padding:0}.tools{display:none}main{padding:0;max-width:none}@page{margin:15mm}tr{break-inside:avoid}}@media(max-width:600px){body{padding:8px}main{padding:18px}.table-wrap{overflow:auto}table{font-size:12px}}</style></head><body><div class="tools"><button id="print-receipt" type="button">Cetak / Simpan PDF</button></div><main><h1>${esc(settings.store_name)}</h1>${settings.contact_email?`<p>Email layanan: ${esc(settings.contact_email)}</p>`:''}${settings.contact_phone?`<p>Telepon layanan: ${esc(settings.contact_phone)}</p>`:''}<hr><h2>Bukti Pembatalan Permintaan Pesanan</h2><div class="meta"><p>Nomor bukti: BATAL-${esc(order.id)}<br>Nomor permintaan: ${esc(order.id)}<br>Tanggal pembatalan: ${esc(event?formatDate(event.created_at):'Belum tercatat')}</p></div><p><strong>Pembeli:</strong> ${esc(order.customer_name)}<br>Email: ${esc(email)}<br>Kontak: ${esc(maskedPhone)}</p><p><strong>Status: Dibatalkan</strong>${note?'<br>Catatan: '+esc(note):''}</p><div class="table-wrap"><table><thead><tr><th>Produk</th><th>Pilihan</th><th>Jumlah</th><th>Harga satuan</th><th>Subtotal</th></tr></thead><tbody>${items.map(item=>`<tr><td>${esc(item.name)}</td><td>${esc([item.size,item.color].filter(Boolean).join(' / ')||'—')}</td><td>${esc(item.qty)}</td><td>${esc(money(item.unit_price_idr))}</td><td>${esc(money(item.unit_price_idr*item.qty))}</td></tr>`).join('')}</tbody></table></div><p><strong>Subtotal produk: ${esc(money(order.subtotal_idr))}</strong><br>Ongkir: ${order.shipping_idr===null?'Belum dikonfirmasi':esc(money(order.shipping_idr))}</p><div class="notice">Dokumen ini hanya mencatat pembatalan permintaan pesanan. Ini bukan bukti pembayaran, pengembalian barang, atau pengembalian dana. Tidak ada instruksi transfer pada dokumen ini.</div><small>Dokumen pribadi untuk pembeli terkait dan admin ${esc(settings.store_name)}. Kontak pembeli disamarkan pada dokumen cetak.</small></main><script nonce="${nonce}">document.getElementById('print-receipt').addEventListener('click',()=>window.print());</script></body></html>`;
 return new Response(page,{headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow, noarchive','Content-Security-Policy':`default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`}});
}
const contactWorker = {async fetch(req,env,ctx){
 const u=new URL(req.url),path=u.pathname;
 if(!['/store-contact','/admin/settings','/admin/cancellation-receipt','/cancellation-receipt'].includes(path))return orderWorker.fetch(req,env,ctx);
 try{
 if(path==='/store-contact'&&req.method==='GET')return orderJson(await storeSettings(env));
 const isAdmin=path.startsWith('/admin/');
 if(isAdmin){
  if(!env.ADMIN_PASSWORD||env.ADMIN_PASSWORD.length<20)return reply({error:'Admin belum dikonfigurasi.'},503);
  if(!await auth(req,env))return new Response('Login admin diperlukan',{status:401,headers:{'WWW-Authenticate':'Basic realm="WYH Admin", charset="UTF-8"','Cache-Control':'no-store'}});
 }
 if(path==='/admin/settings'&&req.method==='GET'){
  const s=await storeSettings(env);return html(`<h2>Kontak toko</h2>${u.searchParams.has('saved')?'<p>Kontak toko berhasil disimpan.</p>':''}<p>Isi hanya email dan nomor layanan yang boleh dilihat customer. Jangan memasukkan kunci atau password.</p><form method="post" action="/admin/settings"><input type="hidden" name="csrf" value="${await csrfToken(env)}"><label>Nama toko<input name="store_name" required maxlength="100" value="${esc(s.store_name)}"></label><label>Email layanan<input name="contact_email" type="email" maxlength="254" value="${esc(s.contact_email)}"></label><label>Nomor telepon layanan<input name="contact_phone" type="tel" maxlength="40" value="${esc(s.contact_phone)}"></label><button>Simpan kontak toko</button></form><p>Email dan telepon boleh dibiarkan kosong. Informasi yang belum diisi tidak dicetak pada bukti pembatalan.</p>`);
 }
 if(path==='/admin/settings'&&req.method==='POST'){
  const origin=req.headers.get('Origin');if(origin&&origin!=='null'&&origin!==u.origin)return reply({error:'Origin rejected'},403);
  const length=Number(req.headers.get('Content-Length'));if(length>10000)return reply({error:'Form terlalu besar.'},413);
  const f=await req.formData();if(!await validCsrf(String(f.get('csrf')||''),env))return html('<p>Formulir kedaluwarsa. Buka ulang pengaturan kontak toko.</p>');
  const name=String(f.get('store_name')||'').trim(),email=String(f.get('contact_email')||'').trim(),phone=String(f.get('contact_phone')||'').trim();
  if(!name||name.length>100||email.length>254||(email&&!/^\S+@\S+\.\S+$/.test(email))||phone.length>40||(phone&&!/^[+0-9() .-]+$/.test(phone))||/[\r\n]/.test(name+email+phone))return html('<p>Periksa nama, email, dan nomor telepon. Perubahan belum disimpan.</p><a href="/admin/settings">Kembali</a>');
  await env.DB.prepare('INSERT INTO store_settings(id,store_name,contact_email,contact_phone) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET store_name=excluded.store_name,contact_email=excluded.contact_email,contact_phone=excluded.contact_phone,updated_at=CURRENT_TIMESTAMP').bind(name,email,phone).run();
  return new Response(null,{status:303,headers:{Location:'/admin/settings?saved=1','Cache-Control':'no-store'}});
 }
 if((path==='/admin/cancellation-receipt'||path==='/cancellation-receipt')&&req.method==='GET'){
  const id=u.searchParams.get('id')||'';
  if(!isAdmin&&!await tokenValid(env,id,u.searchParams.get('token')||''))return orderJson({error:'Akses tidak valid.'},403);
  const order=await env.DB.prepare('SELECT * FROM order_requests WHERE id=?').bind(id).first();if(!order)return orderJson({error:'Tidak ditemukan.'},404);
  if(order.status!=='cancelled')return orderJson({error:'Bukti hanya tersedia untuk permintaan yang sudah dibatalkan.'},409);
  return cancellationReceipt(env,order);
 }
 return reply({error:'Method not allowed'},405);
 }catch{return reply({error:'Pengaturan kontak atau bukti belum siap. Periksa tabel store_settings.'},503);}
}};

const adminEnglishPairs=[
['Rincian','Breakdown'],['Subtotal produk','Product subtotal'],['Ongkir','Shipping'],['Total pesanan','Order total'],['USD/EUR hanya estimasi. Nilai dasar pesanan tetap IDR.','USD/EUR are estimates only. The base order value remains in IDR.'],['Ongkir IDR, contoh 1.000.000,00','Shipping in IDR, e.g. 1.000.000,00'],['Angka desimal ,00 hanya format tampilan. Ongkir disimpan sebagai rupiah bulat. Estimasi USD/EUR diperbarui setelah disimpan.','The ,00 decimals are display formatting only. Shipping is stored as whole rupiah. USD/EUR estimates update after saving.'],
['Ongkir dan total IDR','Shipping and IDR total'],['Ongkir dan total berhasil disimpan.','Shipping and total saved.'],['Total pesanan IDR:','Order total in IDR:'],['Ini rincian biaya, bukan tagihan pembayaran. Stok belum direservasi.','This is a cost breakdown, not a payment request. Stock has not been reserved.'],['Ongkir IDR, angka tanpa titik','Shipping in IDR, digits only'],['Isi 0 untuk gratis ongkir. Jangan menebak biaya; periksa tujuan dan tarif pengiriman terlebih dahulu.','Enter 0 for free shipping. Do not guess the cost; check the destination and shipping rate first.'],['Catatan ongkir','Shipping note'],['Saya telah memeriksa tujuan dan menyetujui ongkir ini.','I have checked the destination and approve this shipping cost.'],['Simpan ongkir dan total','Save shipping and total'],['Pengubahan ongkir dikunci untuk status pesanan ini.','Shipping changes are locked for this order status.'],['Ongkir dan total diperbarui','Shipping and total updated'],
['Harga dasar: IDR','Base prices: IDR'],['Estimasi US$','Estimated US$'],['Estimasi €','Estimated €'],['Ubah harga IDR saja. USD/EUR dihitung otomatis dan tidak bisa diedit. Ini estimasi, bukan kurs pembayaran.','Edit IDR prices only. USD/EUR are calculated automatically and cannot be edited. These are estimates, not payment exchange rates.'],['Kurs harian terakhir:','Daily rates last updated:'],['Kurs tidak tersedia. Estimasi USD/EUR tidak ditampilkan.','Rates are unavailable. USD/EUR estimates are not displayed.'],
['Pembayaran belum aktif. Permintaan pesanan perlu diperiksa admin.','Payments are not active. Order requests require admin review.'],
['Produk','Products'],['Pesanan','Orders'],['Kontak toko','Store contact details'],['Permintaan pesanan','Order requests'],['← Admin produk','← Product admin'],['← Permintaan pesanan','← Order requests'],['Tanggal','Date'],['Pelanggan','Customer'],['Subtotal IDR','Subtotal (IDR)'],['Status','Status'],['Periksa','Review'],['Belum ada permintaan pesanan.','There are no order requests yet.'],['Tidak ada reservasi stok atau instruksi pembayaran otomatis. Maksimal 100 permintaan terbaru.','No stock is reserved and no payment instructions are sent automatically. Showing up to 100 recent requests.'],
['Menunggu konfirmasi','Awaiting confirmation'],['Menunggu pembayaran','Awaiting payment'],['Lunas','Paid'],['Dibatalkan','Cancelled'],['Selesai','Completed'],['Belum dikonfirmasi','Not confirmed'],['Catatan admin','Admin note'],['Saya memastikan pesanan belum dibayar dan menyetujui pembatalan.','I confirm that this order has not been paid and approve its cancellation.'],['Batalkan pesanan belum dibayar','Cancel unpaid order'],['Riwayat terbaru','Recent activity'],['Permintaan pesanan dibuat','Order request created'],['Customer mengajukan perubahan','Customer requested changes'],['Pesanan diperbarui','Order updated'],['Customer mengajukan pembatalan','Customer requested cancellation'],['Pesanan dibatalkan','Order cancelled'],['Pesanan dikonfirmasi','Order confirmed'],['Pembayaran diverifikasi','Payment verified'],['Pesanan selesai','Order completed'],['Aktivitas pesanan','Order activity'],['Sistem','System'],['Stok belum direservasi.','Stock has not been reserved.'],['Rekening belum diatur. Jangan meminta transfer. Stok belum direservasi.','Bank details have not been configured. Do not request a transfer. Stock has not been reserved.'],
['Kontak toko berhasil disimpan.','Store contact details saved.'],['Isi hanya email dan nomor layanan yang boleh dilihat customer. Jangan memasukkan kunci atau password.','Enter only customer-facing support contact details. Do not enter secret keys or passwords.'],['Nama toko','Store name'],['Email layanan','Support email'],['Nomor telepon layanan','Support phone number'],['Simpan kontak toko','Save store contact details'],['Email dan telepon boleh dibiarkan kosong. Informasi yang belum diisi tidak dicetak pada bukti pembatalan.','Email and phone may be left blank. Empty contact details will not appear on the cancellation receipt.'],['Kontak layanan belum diisi.','Support contact details have not been entered.'],['Isi kontak toko','Enter store contact details'],
['Cetak bukti pembatalan','Print cancellation receipt'],['Cetak / Simpan PDF','Print / Save as PDF'],['Bukti Pembatalan Permintaan Pesanan','Order Request Cancellation Receipt'],['Pembeli:','Buyer:'],['Pilihan','Options'],['Jumlah','Quantity'],['Harga IDR','Price (IDR)'],['Harga satuan','Unit price'],['Subtotal','Subtotal'],['Dokumen ini hanya mencatat pembatalan permintaan pesanan. Ini bukan bukti pembayaran, pengembalian barang, atau pengembalian dana. Tidak ada instruksi transfer pada dokumen ini.','This document records only the cancellation of an order request. It is not proof of payment, a product return, or a refund. It contains no payment instructions.'],['Belum tercatat','Not recorded'],
['Tambah produk','Add product'],['Edit produk','Edit product'],['Nama produk','Product name'],['Deskripsi','Description'],['Harga IDR, angka tanpa titik','Price in IDR, digits only'],['Stok total model','Total stock for this model'],['Gambar utama JPG/PNG/WebP, maksimal 5 MB','Main image: JPG/PNG/WebP, up to 5 MB'],['Upload terkunci sampai penyimpanan R2 IMAGES dihubungkan.','Image uploads are disabled until R2 storage is connected as IMAGES.'],['Tampilkan di katalog API','Publish in the catalogue API'],['Mengaktifkan produk tidak membuka checkout. Ukuran, warna dan stok per kombinasi belum dapat diedit di versi admin ini.','Publishing a product does not enable checkout. Sizes, colours and stock by combination cannot yet be edited in this admin version.'],['Simpan produk','Save product'],['Produk berhasil disimpan.','Product saved.'],['← Daftar produk','← Product list'],['Stok','Stock'],['Draf','Draft'],['Aktif','Active'],['Harga IDR','Price (IDR)'],['Belum diisi','Not set'],['Login memakai autentikasi browser. Pada perangkat bersama, gunakan mode privat dan tutup seluruh jendela privat setelah selesai.','Login uses browser authentication. On shared devices, use a private window and close all private windows when finished.'],['Checkout dan pembayaran belum aktif. Stok di sini adalah total per model.','Checkout and payments are not active. Stock shown here is the total per model.'],['Checkout dan pembayaran belum aktif.','Checkout and payments are not active.'],['Penggantian produk dan konfirmasi pembayaran belum dapat dilakukan dari versi ini.','Product replacement and payment confirmation are not available in this version.']
];
const adminEnglish=new Map(adminEnglishPairs);
function englishAdminText(text){
 const value=text.trim();if(!value)return text;
 let out=adminEnglish.get(value);
 if(out===undefined){
  const prefixes=[['Catatan: ','Note: '],['Status sebelumnya: ','Previous status: '],['Status: ','Status: '],['Subtotal produk: ','Product subtotal: '],['Subtotal: ','Subtotal: '],['Ongkir: ','Shipping: '],['Nomor bukti: ','Receipt number: '],['Nomor permintaan: ','Request number: '],['Tanggal pembatalan: ','Cancellation date: '],['Kontak: ','Contact: '],['Email layanan: ','Support email: '],['Telepon layanan: ','Support phone: '],['Telepon: ','Phone: '],['Bantuan ','Support: ']];
  for(const [from,to] of prefixes)if(value.startsWith(from)){const rest=value.slice(from.length);out=to+(from==='Catatan: '?rest:(adminEnglish.get(rest)||rest));break;}
  if(/^\d+ baris produk dicatat\.$/.test(value))out=value.replace(' baris produk dicatat.',' product lines recorded.');
  if(value.startsWith('Dokumen pribadi untuk pembeli terkait dan admin '))out=value.replace('Dokumen pribadi untuk pembeli terkait dan admin ','Private document for the relevant buyer and the admin of ').replace('. Kontak pembeli disamarkan pada dokumen cetak.','. Buyer contact details are masked on the printed document.');
 }
 return out===undefined?text:text.replace(value,out);
}
// Catalogue v2: stable product identity; size stock is authoritative; additive metadata.
const wyhKnownCategories={ 'black-biker':'jacket','cognac-racer':'jacket','espresso-racer':'jacket','brown-trucker':'jacket','cognac-duffel':'travel','graphite-duffel':'travel','navy-duffel':'travel','espresso-bifold':'wallet','cognac-holder':'wallet','brown-derby':'shoes','chelsea-boots':'shoes','penny-loafers':'shoes'};
const wyhCategories={travel:'Tas perjalanan',wallet:'Dompet dan aksesori',shoes:'Sepatu',jacket:'Jaket'};
function wyhPhotoFile(value){return value===''||/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,150}\.(?:jpg|jpeg|png|webp)$/i.test(value);}
function wyhList(value,max=50){const a=String(value||'').split(',').map(x=>x.trim()).filter(Boolean);if(a.length>max||new Set(a).size!==a.length||a.some(x=>!/^[a-zA-Z0-9 ._-]{1,40}$/.test(x)))return null;return a;}
function wyhStock(value){const s=String(value);return /^\d{1,9}$/.test(s)&&Number(s)<=100000000?Number(s):null;}
function wyhColors(meta,category){let colors=[];try{colors=JSON.parse(meta?.colors_json||'[]');}catch{}return Array.isArray(colors)&&colors.every(x=>typeof x==='string')&&colors.length?colors:(category==='shoes'?['Hitam','Brown Gold']:[]);}
async function wyhCatalogRead(env,id){const p=await env.DB.prepare('SELECT p.*,c.description,c.image_key FROM products p LEFT JOIN product_content c ON c.product_id=p.id WHERE p.id=?').bind(id).first();if(!p)return null;const variants=await env.DB.prepare('SELECT size,stock FROM product_variants WHERE product_id=? ORDER BY size').bind(id).all();const metadata=await env.DB.prepare('SELECT category,image_file,colors_json FROM wyh_catalog_metadata WHERE product_id=?').bind(id).first();return {p,variants:variants.results,metadata};}
async function wyhCatalogFingerprint(record){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(record)))),b=>b.toString(16).padStart(2,'0')).join('');}
async function wyhPublicCatalog(req,env){
 const u=new URL(req.url),after=u.searchParams.get('after')||'';if(after&&!/^[a-zA-Z0-9_-]{1,100}$/.test(after))return reply({error:'Invalid catalogue cursor'},400);
 const known=Object.keys(wyhKnownCategories).map(x=>"'"+x+"'").join(',');
 const r=await env.DB.prepare("SELECT p.id,p.name,p.price_idr,p.stock,c.description,m.category,m.image_file,m.colors_json,(SELECT SUM(v.stock) FROM product_variants v WHERE v.product_id=p.id) AS size_stock FROM products p LEFT JOIN product_content c ON c.product_id=p.id LEFT JOIN wyh_catalog_metadata m ON m.product_id=p.id WHERE p.active=1 AND p.price_idr>0 AND p.id>? AND (m.product_id IS NOT NULL OR p.id IN ("+known+")) ORDER BY p.id LIMIT 51").bind(after).all();
 const rows=r.results.slice(0,50);let variants=[];if(rows.length){const marks=rows.map(()=>'?').join(',');const v=await env.DB.prepare('SELECT product_id,size,stock FROM product_variants WHERE product_id IN ('+marks+') ORDER BY product_id,size').bind(...rows.map(x=>x.id)).all();variants=v.results;}
 const products=rows.map(row=>{const sizes=variants.filter(v=>v.product_id===row.id).map(v=>v.size),category=row.category||wyhKnownCategories[row.id];return {id:row.id,name:row.name,price_idr:row.price_idr,stock:sizes.length?row.size_stock:row.stock,description:row.description||'',category,image_url:row.image_file?'https://hobbigo.github.io/wyh-web/'+encodeURIComponent(row.image_file):'',sizes,colors:wyhColors(row,category),stock_scope:sizes.length?'size_total_across_colors':'product_total'};});
 return reply({catalog_version:2,products,limit:50,has_more:r.results.length>50,next_cursor:r.results.length>50?rows.at(-1).id:null,checkout_enabled:false});
}
async function wyhCatalogList(req,env){
 const u=new URL(req.url),page=Math.max(1,Math.min(10000,Number(u.searchParams.get('page'))||1));if(!Number.isInteger(page))return reply({error:'Invalid page'},400);
 const result=await env.DB.prepare('SELECT p.id,p.name,p.price_idr,p.stock,p.active,m.category,(SELECT SUM(v.stock) FROM product_variants v WHERE v.product_id=p.id) AS size_stock,(SELECT COUNT(*) FROM product_variants v WHERE v.product_id=p.id) AS size_count FROM products p LEFT JOIN wyh_catalog_metadata m ON m.product_id=p.id ORDER BY p.name,p.id LIMIT 51 OFFSET ?').bind((page-1)*50).all();const rates=await adminRates();
 const rows=result.results.slice(0,50).map(p=>{const total=p.size_count?p.size_stock:p.stock;return '<tr><td>'+esc(p.name)+'<br><small>'+esc(p.id)+'</small></td><td>'+esc(adminMoney(p.price_idr))+'</td><td>'+esc(rates?adminMoney(p.price_idr,'USD',rates.rates.USD):'—')+'</td><td>'+esc(rates?adminMoney(p.price_idr,'EUR',rates.rates.EUR):'—')+'</td><td>'+esc(total)+'<br><small>'+(p.size_count?'Jumlah stok ukuran':'Stok per item')+'</small></td><td>'+(p.active?'Aktif':'Draf')+'</td><td><a href="/admin/edit?id='+encodeURIComponent(p.id)+'">Edit</a></td></tr>';}).join('');
 return html('<h2>Produk dan stok</h2><p>Produk baru mendapat ID baru. Jangan menimpa identitas produk lama. Nonaktifkan produk lama untuk mengarsipkan dari katalog.</p><p>Stok produk berukuran dihitung dari jumlah stok ukuran. Pilihan warna berbagi stok ukuran, bukan stok tambahan per warna.</p><p><a href="/admin/edit">+ Tambah produk baru</a></p><div class="scroll"><table style="min-width:960px"><tr><th>Produk / ID</th><th>Harga IDR</th><th>Estimasi US$</th><th>Estimasi €</th><th>Stok</th><th>Status</th><th></th></tr>'+rows+'</table></div><p>Halaman '+page+' · '+(page>1?'<a href="/admin?page='+(page-1)+'">Sebelumnya</a>':'')+' '+(result.results.length>50?'<a href="/admin?page='+(page+1)+'">Berikutnya</a>':'')+'</p><p><small>USD/EUR hanya estimasi. Harga dasar tetap IDR. <a href="https://www.exchangerate-api.com" target="_blank" rel="noopener noreferrer">ExchangeRate-API</a></small></p>');
}
async function wyhCatalogForm(req,env){
 const id=new URL(req.url).searchParams.get('id')||'';const record=id?await wyhCatalogRead(env,id):null;if(id&&!record)return reply({error:'Not found'},404);const p=record?.p||{},v=record?.variants||[],m=record?.metadata||{},category=m.category||wyhKnownCategories[id]||'wallet';const colors=wyhColors(m,category);
 const total=v.length?v.reduce((n,x)=>n+x.stock,0):(p.stock||0);const options=Object.entries(wyhCategories).map(([key,label])=>'<option value="'+key+'" '+(key===category?'selected':'')+'>'+esc(label)+'</option>').join('');
 const variantRows=v.map(x=>'<tr><td><input name="v_size" readonly value="'+esc(x.size)+'"></td><td><input type="number" name="v_stock" min="0" max="100000000" step="1" required value="'+esc(x.stock)+'"></td></tr>').join('');
 return html((new URL(req.url).searchParams.has('saved')?'<p>Produk dan stok berhasil disimpan.</p>':'')+'<p><a href="/admin">← Produk dan stok</a></p><h2>'+(id?'Edit produk':'Tambah produk baru')+'</h2><p><strong>'+esc(id||'ID produk baru akan dibuat otomatis')+'</strong></p><p>Untuk model yang berbeda, buat produk baru. Jangan mengganti identitas produk lama yang punya riwayat pesanan.</p><form method="post" action="/admin/catalog/save"><input type="hidden" name="csrf" value="'+esc(await csrfToken(env))+'"><input type="hidden" name="id" value="'+esc(id)+'"><input type="hidden" name="fingerprint" value="'+esc(record?await wyhCatalogFingerprint(record):'new')+'"><label>Nama produk<input name="name" required maxlength="200" value="'+esc(p.name)+'"></label><label>Deskripsi / bahan<textarea name="description" maxlength="5000">'+esc(p.description)+'</textarea></label><label>Kategori<select name="category">'+options+'</select></label><label>Harga IDR, angka bulat atau format 1.000.000,00<input name="price" inputmode="decimal" required maxlength="24" value="'+esc(p.price_idr==null?'':adminMoney(p.price_idr).replace(/^Rp/,''))+'"></label><label>Nama file foto di GitHub<input name="image_file" maxlength="160" placeholder="produk-baru.jpg" value="'+esc(m.image_file||'')+'"></label><small>Unggah foto ke root repo HobbiGo/wyh-web, lalu isi nama file persis. Ini tidak mengaktifkan upload R2. Foto produk lama tetap dipakai bila kolom ini kosong.</small><label>Pilihan warna, pisahkan dengan koma<input name="colors" maxlength="450" value="'+esc(colors.join(', '))+'"></label><p><small>Warna hanya pilihan tampilan. Bila berukuran, stok setiap ukuran dibagi bersama semua warna.</small></p><h3>Stok</h3><p>Total sekarang: '+esc(total)+'</p>'+(v.length?'<input type="hidden" name="inventory_mode" value="sizes"><p>Stok total dihitung otomatis dari tabel di bawah. Isi 0 untuk ukuran habis; jangan menghapus ukuran lama.</p><table><tr><th>Ukuran</th><th>Stok gabungan warna</th></tr>'+variantRows+'</table>':'<label>Model stok<select name="inventory_mode"><option value="unit">Per item, tanpa ukuran</option><option value="sizes">Per ukuran, gabungan warna</option></select></label><label>Stok per item (hanya bila tanpa ukuran)<input name="unit_stock" type="number" min="0" max="100000000" step="1" value="'+esc(p.stock||0)+'"></label>')+'<label>Tambah ukuran baru, pisahkan dengan koma<input name="add_sizes" maxlength="1000" placeholder="S, M, L atau 43, 44, 45"></label><label>Stok awal untuk setiap ukuran BARU<input name="new_size_stock" type="number" min="0" max="100000000" step="1" value="0"></label><small>Ukuran yang sudah ada tidak akan diisi ulang oleh kolom stok awal.</small><label><input type="checkbox" name="active" '+(p.active?'checked':'')+'> Tampilkan di katalog</label><p>Produk baru disimpan sebagai draf jika tidak dicentang. Harga positif dan foto diperlukan sebelum produk baru ditampilkan.</p><label><input type="checkbox" name="confirm_stock" required> Saya sudah memeriksa stok per item atau ukuran. Warna tidak menggandakan stok.</label><button>Simpan produk dan stok</button></form>');
}
async function wyhCatalogSave(req,env){
 const u=new URL(req.url),origin=req.headers.get('Origin');if(origin&&origin!=='null'&&origin!==u.origin)return reply({error:'Origin rejected'},403);const length=Number(req.headers.get('Content-Length'));if(length>40000)return reply({error:'Form terlalu besar'},413);
 const f=await req.formData();if(!await validCsrf(String(f.get('csrf')||''),env))return html('<p>Formulir kedaluwarsa. Buka ulang halaman produk.</p>');
 const oldId=String(f.get('id')||''),id=oldId||'wyh-'+crypto.randomUUID(),name=String(f.get('name')||'').trim(),description=String(f.get('description')||'').trim(),category=String(f.get('category')||''),image=String(f.get('image_file')||'').trim(),price=parseShippingIDR(f.get('price')||''),colors=wyhList(f.get('colors'),10),added=wyhList(f.get('add_sizes'),50),mode=String(f.get('inventory_mode')||''),active=f.get('active')==='on'?1:0;
 const fail=message=>html('<p>'+esc(message)+'</p><a href="/admin/edit'+(oldId?'?id='+encodeURIComponent(oldId):'')+'">Buka ulang formulir</a>');
 if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id)||!name||name.length>200||description.length>5000||!Object.hasOwn(wyhCategories,category)||!wyhPhotoFile(image)||price===null||!colors||!added||!['unit','sizes'].includes(mode)||f.get('confirm_stock')!=='on')return fail('Data belum valid. Periksa nama, harga IDR, kategori, file foto, dan konfirmasi stok.');
 const existing=oldId?await wyhCatalogRead(env,oldId):null;if(oldId&&!existing)return reply({error:'Not found'},404);
 if(existing&&String(f.get('fingerprint')||'')!==await wyhCatalogFingerprint(existing))return fail('Data berubah sejak formulir dibuka. Buka ulang agar perubahan admin lain tidak tertimpa.');
 if(active&&(price<=0||(!image&&!Object.hasOwn(wyhKnownCategories,id))))return fail('Produk aktif perlu harga positif dan nama file foto. Produk baru tanpa foto harus tetap draf.');
 const before=existing?.variants||[];if(before.length&&mode!=='sizes')return fail('Produk dengan stok ukuran tidak boleh dialihkan menjadi stok per item.');
 const sizes=f.getAll('v_size').map(String),stocks=f.getAll('v_stock').map(wyhStock);let next=[];
 if(mode==='sizes'){
  if(sizes.length!==stocks.length||sizes.length!==before.length||stocks.some(x=>x===null)||new Set(sizes).size!==sizes.length||before.some(v=>!sizes.includes(v.size)))return fail('Ukuran lama harus tetap lengkap. Gunakan stok 0 bila habis, jangan menghapus baris.');
  next=sizes.map((size,i)=>({size,stock:stocks[i]}));const initial=wyhStock(f.get('new_size_stock')||'0');if(initial===null)return fail('Stok awal ukuran tidak valid.');
  for(const size of added){if(size.length>20)return fail('Nama ukuran maksimal 20 karakter.');if(!next.some(v=>v.size===size))next.push({size,stock:initial});}
  if(!next.length||next.length>40)return fail('Produk berukuran memerlukan 1 sampai 40 ukuran.');
 }else if(added.length)return fail('Pilih model stok per ukuran sebelum menambahkan ukuran.');
 const stock=mode==='sizes'?next.reduce((sum,v)=>sum+v.stock,0):wyhStock(f.get('unit_stock')||'0');if(stock===null||!Number.isSafeInteger(stock))return fail('Stok total tidak valid.');
 const batch=[env.DB.prepare('INSERT INTO products(id,name,price_idr,stock,active) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,price_idr=excluded.price_idr,stock=excluded.stock,active=excluded.active').bind(id,name,price,stock,active),env.DB.prepare('INSERT INTO product_content(product_id,description,image_key) VALUES(?,?,NULL) ON CONFLICT(product_id) DO UPDATE SET description=excluded.description').bind(id,description),env.DB.prepare('INSERT INTO wyh_catalog_metadata(product_id,category,image_file,colors_json) VALUES(?,?,?,?) ON CONFLICT(product_id) DO UPDATE SET category=excluded.category,image_file=excluded.image_file,colors_json=excluded.colors_json,updated_at=CURRENT_TIMESTAMP').bind(id,category,image,JSON.stringify(colors))];
 for(const v of next)batch.push(env.DB.prepare('INSERT INTO product_variants(product_id,size,stock) VALUES(?,?,?) ON CONFLICT(product_id,size) DO UPDATE SET stock=excluded.stock').bind(id,v.size,v.stock));
 if(next.length)batch.push(env.DB.prepare('UPDATE products SET stock=(SELECT COALESCE(SUM(stock),0) FROM product_variants WHERE product_id=?) WHERE id=?').bind(id,id));
 batch.push(env.DB.prepare('INSERT INTO wyh_inventory_events(product_id,event_type,details_json) VALUES(?,?,?)').bind(id,oldId?'product_saved':'product_created',JSON.stringify({previous_stock:before.length?before.reduce((sum,v)=>sum+v.stock,0):(existing?.p.stock??null),stock,mode,variants_before:before,variants_after:next,active,price_idr:price})));
 await env.DB.batch(batch);return new Response(null,{status:303,headers:{Location:'/admin/edit?id='+encodeURIComponent(id)+'&saved=1','Cache-Control':'no-store'}});
}
async function wyhAllowedOrderColors(env,id){let m=null;try{m=await env.DB.prepare('SELECT category,colors_json FROM wyh_catalog_metadata WHERE product_id=?').bind(id).first();}catch{}return wyhColors(m,m?.category||wyhKnownCategories[id]);}
const catalogWorker={async fetch(req,env,ctx){const path=new URL(req.url).pathname;
 if(path==='/products'&&req.method==='GET'){try{return await wyhPublicCatalog(req,env);}catch{return baseWorker.fetch(req,env,ctx);}}
 if(!['/admin','/admin/','/admin/edit','/admin/save','/admin/catalog/save'].includes(path))return contactWorker.fetch(req,env,ctx);
 if(!env.ADMIN_PASSWORD||env.ADMIN_PASSWORD.length<20)return reply({error:'Admin locked'},503);if(!await auth(req,env))return new Response('Login admin diperlukan',{status:401,headers:{'WWW-Authenticate':'Basic realm="WYH Admin", charset="UTF-8"','Cache-Control':'no-store'}});
 try{if(path==='/admin/save')return html('<p>Formulir produk lama tidak dipakai untuk menjaga konsistensi stok. Buka ulang produk dari daftar admin.</p><a href="/admin">Produk dan stok</a>');
 if(req.method==='GET'&&(path==='/admin'||path==='/admin/'))return await wyhCatalogList(req,env);
 if(req.method==='GET'&&path==='/admin/edit')return await wyhCatalogForm(req,env);
 if(req.method==='POST'&&path==='/admin/catalog/save')return await wyhCatalogSave(req,env);
 return reply({error:'Method not allowed'},405);
 }catch{return html('<p>Pengelolaan katalog belum siap. Pastikan tabel wyh_catalog_metadata dan wyh_inventory_events sudah dibuat. Jangan mengulang penyimpanan sebelum memeriksa produk.</p><a href="/admin">Kembali ke admin</a>');}
}};
export default {async fetch(req,env,ctx){
 const response=await catalogWorker.fetch(req,env,ctx);
 const u=new URL(req.url);if(!response.headers.get('Content-Type')?.includes('text/html')||(!u.pathname.startsWith('/admin')&&!u.pathname.includes('cancellation-receipt')))return response;
 const cookie=(req.headers.get('Cookie')||'').match(/(?:^|;\s*)wyh_admin_language=(en|id)(?:;|$)/)?.[1];
 const lang=['en','id'].includes(u.searchParams.get('lang'))?u.searchParams.get('lang'):(cookie||'id');
 let page=await response.text();
 if(lang==='en'){
  // Translate rendered text only. Preserve form values, product names, user notes and scripts.
  const preserved=[];page=page.replace(/<(script|style|textarea)\b[^>]*>[\s\S]*?<\/\1>/gi,block=>{const marker='WYHPRESERVEDBLOCK'+preserved.length+'END';preserved.push(block);return marker;});
  page=page.replace(/>([^<>]+)</g,(whole,text)=>'>'+englishAdminText(text)+'<');
  page=page.replace(/WYHPRESERVEDBLOCK(\d+)END/g,(_,i)=>preserved[Number(i)]);
  page=page.replace('lang="id"','lang="en"');
 }
 const en=new URL(u),id=new URL(u);en.searchParams.set('lang','en');id.searchParams.set('lang','id');
 const languageNav=`<nav class="wyh-language-tools" aria-label="Language" style="max-width:1000px;margin:12px auto;padding:0 20px"><a href="${esc(id.href)}">Indonesia</a> · <a href="${esc(en.href)}">English</a></nav>`;
 page=page.replace(/<body([^>]*)>/i,match=>match+languageNav);
 page=page.replace('</head>','<style>@media print{.wyh-language-tools{display:none}}</style></head>');
 const headers=new Headers(response.headers);headers.delete('Content-Length');headers.set('Cache-Control','private, no-store');headers.set('Referrer-Policy','no-referrer');
 if(u.searchParams.has('lang'))headers.append('Set-Cookie','wyh_admin_language='+lang+'; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax');
 return new Response(page,{status:response.status,headers});
}};
