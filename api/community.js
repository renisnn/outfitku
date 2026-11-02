const {createHash,createHmac,timingSafeEqual}=require('node:crypto');
const MAX_IMAGE=600*1024;
class HttpError extends Error { constructor(status,message){super(message);this.status=status;} }
function tokenHash(value){if(!/^[a-f0-9]{64}$/.test(value||''))throw new HttpError(401,'Identitas browser belum tersedia. Muat ulang halaman.');return createHash('sha256').update(value).digest('hex');}
function validate(body){
 if(!body||typeof body!=='object')throw new HttpError(400,'Data produk tidak valid.');
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.id||''))throw new HttpError(400,'ID produk tidak valid.');
 const p=body.product;if(!p||typeof p.nama!=='string'||!p.nama.trim()||p.nama.length>100||!['atasan','bawahan','dress','outer'].includes(p.kategori))throw new HttpError(400,'Isi nama dan jenis baju.');
 let u;try{u=new URL(p.shopee);}catch{}if(!u||u.protocol!=='https:'||u.username||u.password||!['shopee.co.id','www.shopee.co.id','s.shopee.co.id','id.shp.ee','shp.ee'].includes(u.hostname))throw new HttpError(400,'Link harus menuju Shopee Indonesia.');
 const match=/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(body.image||'');if(!match||match[1].length>MAX_IMAGE*1.34)throw new HttpError(413,'Foto terlalu besar. Kecilkan foto sebelum terbit.');
 const bytes=Buffer.from(match[1],'base64');if(bytes.length>MAX_IMAGE||bytes.length<33||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.toString('ascii',12,16)!=='IHDR'||bytes.readUInt32BE(16)<1||bytes.readUInt32BE(20)<1||bytes.readUInt32BE(16)>1200||bytes.readUInt32BE(20)>1200)throw new HttpError(400,'Foto PNG tidak valid atau terlalu besar.');
 const anchors=String(p.anchors||'');if(anchors.length>5000||anchors.split(';').filter(Boolean).some(x=>!/^\s*[A-Za-z]+\s*=\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*$/.test(x)))throw new HttpError(400,'Titik baju tidak valid.');
 const f=body.fit||{},fit={};for(const [k,min,max,def] of [['x',-25,25,0],['y',-30,30,0],['width',50,180,100],['height',50,180,100],['angle',-30,30,0]]){const n=f[k]??def;if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max)throw new HttpError(400,'Pengaturan baju tidak valid.');fit[k]=n;}fit.keepShape=f.keepShape!==false;
 return {id:body.id,product:{nama:p.nama.trim(),kategori:p.kategori,shopee:u.href,anchors},fit,image:match[1]};
}
function createHandler({env=process.env,fetchImpl=fetch}={}){
 const secret=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY;
 const request=async(path,options={})=>{const response=await fetchImpl(env.SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/'+path,{...options,headers:{apikey:secret,...(secret?.startsWith('sb_secret_')?{}:{Authorization:'Bearer '+secret}),'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(15000)});if(!response.ok){const data=await response.json().catch(()=>({}));if(data.message?.includes('RATE_LIMIT'))throw new HttpError(429,'Batas publikasi tercapai. Coba lagi besok.');if(data.message?.includes('CATALOG_FULL'))throw new HttpError(429,'Katalog publik sedang penuh.');if(data.message?.includes('NOT_OWNER'))throw new HttpError(403,'Unggahan ini bukan milik browser kamu.');throw new HttpError(503,'Penyimpanan katalog belum siap.');}return response.status===204?null:response.json();};
 return async(req,res)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');try{
  if(!env.SUPABASE_URL||!secret||!env.COMMUNITY_RATE_SALT)return res.status(503).json({error:'Katalog bersama belum diaktifkan oleh pemilik website.'});
  const query=req.query||{};
  if(req.method==='GET'){
   if(query.image){const id=String(query.image);if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))throw new HttpError(400,'ID tidak valid.');const rows=await request('community_products?select=image_base64&id=eq.'+encodeURIComponent(id)+'&deleted_at=is.null&limit=1');if(!rows.length)throw new HttpError(404,'Foto tidak ditemukan.');res.setHeader('Content-Type','image/png');res.setHeader('Cache-Control','public,max-age=300');return res.status(200).send(Buffer.from(rows[0].image_base64,'base64'));}
   let owner=null;if(req.headers['x-owner-token'])owner=tokenHash(req.headers['x-owner-token']);
   const offset=Math.max(0,Math.min(200,Number(query.offset)||0));const rows=await request('community_products?select=id,product,fit,owner_hash,created_at&deleted_at=is.null&order=created_at.desc&limit=50&offset='+offset);
   return res.status(200).json({products:rows.map(({owner_hash,...p})=>({...p,owned:!!owner&&owner_hash===owner})),nextOffset:rows.length===50?offset+50:null});
  }
  if(req.method!=='POST'){res.setHeader('Allow','GET, POST');throw new HttpError(405,'Metode tidak tersedia.');}
  // Browser writes must originate from this deployment; cross-site submissions are rejected.
  let origin;try{origin=new URL(req.headers.origin);}catch{}if(!origin||origin.host!==req.headers.host)throw new HttpError(403,'Buka fitur ini dari website Bilik Coba.');
  if(!String(req.headers['content-type']||'').startsWith('application/json'))throw new HttpError(415,'Gunakan JSON.');
  const body=typeof req.body==='string'?JSON.parse(req.body):req.body;if(!body||JSON.stringify(body).length>900000)throw new HttpError(413,'Data terlalu besar.');
  const owner=tokenHash(req.headers['x-owner-token']);const ip=String(req.headers['x-vercel-forwarded-for']||req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0];const ipHash=createHmac('sha256',env.COMMUNITY_RATE_SALT).update(ip).digest('hex');
  if(body.action==='publish'){
   const clean=validate(body);const row=await request('rpc/community_publish',{method:'POST',body:JSON.stringify({p_id:clean.id,p_product:clean.product,p_fit:clean.fit,p_image:clean.image,p_owner:owner,p_ip:ipHash})});return res.status(200).json({id:row});
  }
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.id||''))throw new HttpError(400,'ID tidak valid.');
  if(body.action==='report'){await request('rpc/community_report',{method:'POST',body:JSON.stringify({p_id:body.id,p_ip:ipHash})});return res.status(200).json({ok:true});}
  if(body.action==='delete'){
   const a=Buffer.from(String(req.headers['x-admin-key']||'')),b=Buffer.from(env.COMMUNITY_ADMIN_KEY||'');const admin=b.length>0&&a.length===b.length&&timingSafeEqual(a,b);
   await request('rpc/community_delete',{method:'POST',body:JSON.stringify({p_id:body.id,p_owner:owner,p_admin:admin})});return res.status(200).json({ok:true});
  }
  throw new HttpError(400,'Aksi tidak tersedia.');
 }catch(error){return res.status(error.status||500).json({error:error.status?error.message:'Katalog belum bisa diakses. Coba lagi.'});}};
}
module.exports={createHandler,validate,tokenHash};
