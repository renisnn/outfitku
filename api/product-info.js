const allowed = new Set(['shopee.co.id','www.shopee.co.id','shopee.co.id','shope.ee','s.shopee.co.id']);
function valid(value){const u=new URL(value);if(u.protocol!=='https:'||u.port||u.username||u.password||!allowed.has(u.hostname))throw Error('Gunakan link HTTPS Shopee Indonesia.');return u;}
function extract(html){
 const found=[];const walk=(v,depth=0)=>{if(!v||typeof v!=='object'||depth>25)return;if([].concat(v['@type']||[]).includes('Product'))found.push(v);for(const x of Object.values(v))if(typeof x==='object')Array.isArray(x)?x.forEach(y=>walk(y,depth+1)):walk(x,depth+1);};
 for(const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{walk(JSON.parse(m[1]));}catch{}}
 const p=found[0];if(!p)return null;
 const clean=v=>typeof v==='string'?v.trim().slice(0,150):'';
 const values=k=>[...new Set(found.flatMap(x=>[x,...[].concat(x.hasVariant||[])].flatMap(y=>[].concat(y[k]||[]))).map(x=>clean(typeof x==='object'?x.name:x)).filter(Boolean))].slice(0,40);
 const offers=[].concat(p.offers||[]);const prices=offers.map(x=>x.price??x.lowPrice).filter(x=>x!==null&&x!==undefined&&x!=='').map(Number).filter(x=>Number.isFinite(x)&&x>=0);
 const currency=offers.map(x=>x.priceCurrency).find(Boolean);return {name:clean(p.name),price:(!currency||currency==='IDR')&&prices.length?Math.min(...prices):null,colors:values('color'),sizes:values('size'),priceNote:offers.some(x=>x.lowPrice!==undefined)?'Harga mulai dari; cek varian di toko.':'Cek harga varian dan promo di toko.'};
}
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','no-store');if(req.method!=='POST')return res.status(405).json({error:'Metode tidak didukung.'});
 try{let body=typeof req.body==='string'?JSON.parse(req.body):req.body;let u=valid(body?.url);let response;
 for(let i=0;i<5;i++){response=await fetch(u,{redirect:'manual',signal:AbortSignal.timeout(7000),headers:{Accept:'text/html'}});if([301,302,303,307,308].includes(response.status)){const next=response.headers.get('location');await response.body?.cancel();u=valid(new URL(next,u).href);continue;}break;}
 if(!response?.ok)throw Error('Toko membatasi pembacaan otomatis. Isi detail produk secara manual.');
 if(!response.headers.get('content-type')?.includes('text/html'))throw Error('Link ini bukan halaman produk.');
 let size=0,chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>2000000)throw Error('Halaman terlalu besar untuk dibaca.');chunks.push(chunk);}
 const data=extract(Buffer.concat(chunks).toString('utf8'));if(!data)throw Error('Detail produk tidak tersedia untuk pembacaan otomatis. Isi kolom yang belum terisi.');
 return res.status(200).json(data);
 }catch(e){return res.status(422).json({error:e.name==='TimeoutError'?'Toko terlalu lama merespons. Coba lagi atau isi manual.':e.message||'Detail produk belum bisa dibaca.'});}
};
module.exports.extract=extract;
