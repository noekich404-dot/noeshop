require('dotenv').config();
const express=require('express'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const app=express(),PORT=process.env.PORT||3000,PROD=process.env.NODE_ENV==='production';
if(process.env.VERCEL&&!process.env.SECRET)throw new Error('Env SECRET belum diisi');
const SECRET=process.env.SECRET||'dev-secret-ganti-di-env',SB=(process.env.SUPABASE_URL||'').replace(/\/$/,''),KEY=process.env.SUPABASE_SERVICE_KEY;

/* ---------- Database: Supabase (tabel "docs") lewat REST ---------- */
const rest=async(p,o={})=>{const r=await fetch(`${SB}/rest/v1/docs${p}`,{...o,headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'application/json',...o.headers}});if(!r.ok)throw new Error('DB '+r.status+': '+await r.text());return o.method?null:r.json()};
const all=async c=>{const out=[];for(let o=0;;o+=1000){const r=await rest(`?col=eq.${c}&select=data&order=created.asc,id.asc&limit=1000&offset=${o}`);out.push(...r.map(x=>x.data));if(r.length<1000)return out}};
const get=async(c,i)=>(await rest(`?col=eq.${c}&id=eq.${encodeURIComponent(i)}&select=data`))[0]?.data;
const find=async(c,f,v)=>(await rest(`?col=eq.${c}&data-%3E%3E${f}=eq.${encodeURIComponent(v)}&select=data&limit=1`))[0]?.data;
const put=(c,d)=>rest('?on_conflict=col,id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({col:c,id:d.id,data:d})});
const del=(c,i)=>rest(`?col=eq.${c}&id=eq.${encodeURIComponent(i)}`,{method:'DELETE'});
const getS=async()=>{const{id,...s}=(await get('settings','main'))||{};return s};

/* ---------- Util ---------- */
const uid=()=>crypto.randomBytes(6).toString('hex');
const eq=(a,b)=>a.length===b.length&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
const hash=(p,s=crypto.randomBytes(8).toString('hex'))=>s+':'+crypto.scryptSync(p,s,32).toString('hex');
const check=(p,h)=>eq(hash(p,h.split(':')[0]),h);
const mac=b=>crypto.createHmac('sha256',SECRET).update(b).digest('base64url');
const sign=u=>{const b=Buffer.from(JSON.stringify({id:u.id,exp:Date.now()+6048e5})).toString('base64url');return b+'.'+mac(b)};
const verify=async t=>{try{const[b,s]=String(t).split('.');if(!eq(s,mac(b)))return;const p=JSON.parse(Buffer.from(b,'base64url'));return p.exp>Date.now()?await get('users',p.id):undefined}catch{}};
const pub=({password,resetToken,resetExp,...u})=>u;
const bad=(s,m,c=400)=>s.status(c).json({error:m});
const w=f=>(q,s,n)=>Promise.resolve(f(q,s,n)).catch(e=>{console.error(e);bad(s,'Terjadi kesalahan server',500)});
const auth=(q,s,n)=>q.user?n():bad(s,'Silakan login terlebih dulu',401);
const adm=(q,s,n)=>q.user.role==='admin'?n():bad(s,'Khusus admin',403);
const mail=async(to,subject,html)=>{if(!process.env.RESEND_API_KEY)return false;const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.MAIL_FROM||'NOESHOP <onboarding@resend.dev>',to,subject,html})});return r.ok};

/* ---------- Seed otomatis (sekali) ---------- */
const seed=n=>JSON.parse(fs.readFileSync(path.join(__dirname,'data',n+'.json'),'utf8'));
let booted;
const ready=()=>booted||(booted=(async()=>{
  if(!SB||!KEY)throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY belum diisi');
  if(!(await get('meta','seeded'))){for(const n of['categories','products','banners'])for(const d of seed(n))await put(n,d);await put('settings',{...seed('settings'),id:'main'});await put('meta',{id:'seeded'})}
  if(process.env.ADMIN_PASSWORD&&!(await get('users','admin')))await put('users',{id:'admin',name:'Admin',email:(process.env.ADMIN_EMAIL||'admin@noeshop.id').toLowerCase(),password:hash(process.env.ADMIN_PASSWORD),role:'admin',wishlist:[],created:Date.now()});
})().catch(e=>{booted=null;throw e}));

app.use(express.json());
app.use(w(async(q,s,n)=>{await ready();q.user=await verify((q.headers.authorization||'').slice(7));n()}));

/* ---------- Auth ---------- */
app.post('/api/register',w(async(q,s)=>{const{name,email,password}=q.body;if(!name||!/\S+@\S+\.\S+/.test(email||'')||(password||'').length<6)return bad(s,'Data tidak valid (password minimal 6 karakter)');const em=email.toLowerCase();if(await find('users','email',em))return bad(s,'Email sudah terdaftar');const u={id:uid(),name:String(name).slice(0,60),email:em,password:hash(password),role:'user',wishlist:[],created:Date.now()};await put('users',u);s.json({token:sign(u),user:pub(u)})}));
app.post('/api/login',w(async(q,s)=>{const u=await find('users','email',String(q.body.email||'').toLowerCase());if(!u||!check(String(q.body.password||''),u.password))return bad(s,'Email atau password salah');s.json({token:sign(u),user:pub(u)})}));
app.post('/api/forgot',w(async(q,s)=>{const u=await find('users','email',String(q.body.email||'').toLowerCase());let link;if(u){u.resetToken=crypto.randomBytes(24).toString('hex');u.resetExp=Date.now()+36e5;await put('users',u);link=`${process.env.BASE_URL||(PROD?'':'http://'+q.headers.host)}/reset-password.html?token=${u.resetToken}`;const sent=await mail(u.email,'Reset password NOESHOP',`<p>Klik tautan berikut untuk membuat password baru (berlaku 1 jam):</p><p><a href="${link}">${link}</a></p>`);if(!sent)console.log('LINK RESET PASSWORD:',u.email,link)}s.json({ok:true,devLink:PROD?undefined:link})}));
app.post('/api/reset',w(async(q,s)=>{const t=String(q.body.token||''),u=t&&await find('users','resetToken',t);if(!u||u.resetExp<Date.now()||String(q.body.password||'').length<6)return bad(s,'Token tidak valid/kedaluwarsa atau password kurang dari 6 karakter');u.password=hash(q.body.password);delete u.resetToken;delete u.resetExp;await put('users',u);s.json({ok:true})}));

/* ---------- User ---------- */
app.get('/api/me',auth,(q,s)=>s.json(pub(q.user)));
app.put('/api/me',auth,w(async(q,s)=>{const u=q.user;['name','phone','bio'].forEach(k=>q.body[k]!==undefined&&(u[k]=String(q.body[k]).slice(0,200)));await put('users',u);s.json(pub(u))}));
app.post('/api/me/password',auth,w(async(q,s)=>{const u=q.user;if(!check(String(q.body.current||''),u.password))return bad(s,'Password lama salah');if(String(q.body.password||'').length<6)return bad(s,'Password baru minimal 6 karakter');u.password=hash(q.body.password);await put('users',u);s.json({ok:true})}));
app.post('/api/wishlist/:p',auth,w(async(q,s)=>{const u=q.user,x=new Set(u.wishlist||[]);x.has(q.params.p)?x.delete(q.params.p):x.add(q.params.p);u.wishlist=[...x];await put('users',u);s.json({wishlist:u.wishlist})}));
app.get('/api/me/clicks',auth,w(async(q,s)=>{const[cs,ps]=await Promise.all([rest(`?col=eq.clicks&data-%3E%3EuserId=eq.${q.user.id}&select=data&order=created.desc&limit=100`),all('products')]),pm=Object.fromEntries(ps.map(p=>[p.id,p]));s.json(cs.map(r=>({...r.data,product:pm[r.data.productId]})))}));

/* ---------- Publik ---------- */
app.get('/api/settings',w(async(q,s)=>s.json(await getS())));
app.get('/api/categories',w(async(q,s)=>s.json(await all('categories'))));
app.get('/api/banners',w(async(q,s)=>s.json((await all('banners')).filter(b=>b.active!==false))));
app.get('/api/products',w(async(q,s)=>{let p=(await all('products')).filter(x=>x.active!==false);const{q:t,category:c,market:m,sort}=q.query;if(t)p=p.filter(x=>(x.title+' '+(x.description||'')).toLowerCase().includes(String(t).toLowerCase()));if(c)p=p.filter(x=>x.category===c);if(m)p=p.filter(x=>x.marketplace===m);const O={terbaru:(a,b)=>b.created-a.created,terlaris:(a,b)=>(b.clicks||0)-(a.clicks||0),murah:(a,b)=>a.price-b.price,mahal:(a,b)=>b.price-a.price};s.json(p.sort(O[sort]||O.terbaru))}));
app.get('/api/products/:id',w(async(q,s)=>{const p=await get('products',q.params.id);p&&p.active!==false?s.json(p):bad(s,'Produk tidak ditemukan',404)}));
app.get('/go/:id',w(async(q,s)=>{const p=await get('products',q.params.id);if(!p)return s.redirect('/');const u=await verify((/(?:^|;\s*)nt=([^;]+)/.exec(q.headers.cookie||'')||[])[1]);p.clicks=(p.clicks||0)+1;await Promise.all([put('products',p),put('clicks',{id:uid(),productId:p.id,userId:u?u.id:null,ts:Date.now()})]);s.redirect(p.affiliateUrl)}));

/* ---------- Admin ---------- */
['products','categories','banners'].forEach(n=>{
  app.get(`/api/admin/${n}`,auth,adm,w(async(q,s)=>s.json(await all(n))));
  app.post(`/api/admin/${n}`,auth,adm,w(async(q,s)=>{const x={...q.body,id:uid(),created:Date.now()};if(n==='products')x.clicks=0;else delete x.clicks;await put(n,x);s.json(x)}));
  app.put(`/api/admin/${n}/:id`,auth,adm,w(async(q,s)=>{const c=await get(n,q.params.id);if(!c)return bad(s,'Data tidak ditemukan',404);const x={...c,...q.body,id:c.id};await put(n,x);s.json(x)}));
  app.delete(`/api/admin/${n}/:id`,auth,adm,w(async(q,s)=>{await del(n,q.params.id);s.json({ok:true})}));
});
app.get('/api/admin/users',auth,adm,w(async(q,s)=>s.json((await all('users')).map(pub))));
app.put('/api/admin/users/:id',auth,adm,w(async(q,s)=>{if(q.params.id===q.user.id)return bad(s,'Tidak bisa mengubah role akun sendiri');const u=await get('users',q.params.id);if(!u)return bad(s,'User tidak ditemukan',404);if(['user','admin'].includes(q.body.role))u.role=q.body.role;await put('users',u);s.json(pub(u))}));
app.delete('/api/admin/users/:id',auth,adm,w(async(q,s)=>{if(q.params.id===q.user.id)return bad(s,'Tidak bisa menghapus akun sendiri');await del('users',q.params.id);s.json({ok:true})}));
app.put('/api/admin/settings',auth,adm,w(async(q,s)=>{const d={...await getS(),...q.body};await put('settings',{...d,id:'main'});s.json(d)}));
app.get('/api/admin/stats',auth,adm,w(async(q,s)=>{const[c,ps,us]=await Promise.all([all('clicks'),all('products'),all('users')]),day=t=>new Date(t).toISOString().slice(0,10),pm=Object.fromEntries(ps.map(p=>[p.id,p])),um=Object.fromEntries(us.map(u=>[u.id,u]));
  const daily=[...Array(14)].map((_,i)=>{const d=day(Date.now()-(13-i)*864e5);return{d,n:c.filter(x=>day(x.ts)===d).length}});
  const byMarket={};c.forEach(x=>{const m=pm[x.productId]?.marketplace||'other';byMarket[m]=(byMarket[m]||0)+1});
  s.json({products:ps.length,users:us.length,clicks:c.length,today:daily[13].n,daily,byMarket,top:[...ps].sort((a,b)=>(b.clicks||0)-(a.clicks||0)).slice(0,5).map(p=>({id:p.id,title:p.title,clicks:p.clicks||0})),recent:c.slice(-8).reverse().map(x=>({title:pm[x.productId]?.title||'(produk dihapus)',user:um[x.userId]?.name||'Tamu',ts:x.ts}))})}));

/* ---------- Auto Fetch ---------- */
const dec=t=>(t||'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#0?39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').trim();
app.post('/api/admin/fetch',auth,adm,async(q,s)=>{
  const url=String(q.body.url||'').trim();if(!/^https?:\/\//i.test(url))return bad(s,'Masukkan link yang diawali https://');
  try{
    const r=await fetch(url,{redirect:'follow',headers:{'user-agent':'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)','accept-language':'id-ID,id;q=0.9,en;q=0.8'},signal:AbortSignal.timeout(12000)});
    const h=await r.text(),host=url+' '+r.url;
    const meta=k=>{const a=h.match(new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*?content=["']([^"']*)["']`,'i')),b=h.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*?(?:property|name)=["']${k}["']`,'i'));return dec((a||b||[])[1])};
    const raw=String(meta('product:price:amount')||meta('og:price:amount')||(h.match(/"price"\s*:\s*"?([\d.,]+)/)||[])[1]||'').trim();
    const price=/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw)?+raw.replace(/\./g,'').replace(',','.'):parseFloat(raw.replace(/,/g,''))||0;
    const marketplace=/shopee|shope\.ee/i.test(host)?'shopee':/tokopedia/i.test(host)?'tokopedia':/tiktok/i.test(host)?'tiktok':/lazada/i.test(host)?'lazada':/blibli/i.test(host)?'blibli':'other';
    s.json({title:meta('og:title')||dec((h.match(/<title[^>]*>([^<]*)/i)||[])[1]),price:Math.round(price),image:meta('og:image')||meta('twitter:image'),marketplace,finalUrl:r.url});
  }catch(e){bad(s,'Gagal mengambil data: '+e.message,502)}
});

app.use(express.static(path.join(__dirname,'public')));
module.exports=app;
if(require.main===module)app.listen(PORT,()=>console.log(`NOESHOP berjalan di http://localhost:${PORT}`));
