(function(){
'use strict';
document.addEventListener('error',event=>{if(event.target.matches?.('img.account-profile-image'))event.target.remove();},true);
window.ProfileImages={
placeholder:"<svg class=\"account-person-icon\" viewBox=\"0 0 64 64\" aria-hidden=\"true\"><circle cx=\"32\" cy=\"18\" r=\"11\"/><ellipse cx=\"32\" cy=\"47\" rx=\"22\" ry=\"13\"/></svg>",
markup(photo,name='User'){const safe=this.safe(photo);const escaped=String(name).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));return this.placeholder+(safe?'<img class="account-profile-image" src="'+safe+'" alt="'+escaped+' profile picture">':'');},
mount(target,photo,name){target.innerHTML=this.markup(photo,name);},
safe(value){return typeof value==='string'&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)&&value.length<360000?value:'';},
async read(file){if(!file)return null;if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>10*1024*1024)throw Error('Choose a PNG, JPEG or WebP picture up to 10 MB.');const bitmap=await createImageBitmap(file);try{const scale=Math.min(1,320/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);const data=canvas.toDataURL('image/webp',.8);if(atob(data.split(',')[1]).length>262144)throw Error('Choose a smaller picture.');return data;}finally{bitmap.close();}},
hex(value){if(!value)return null;const bytes=atob(value.split(',')[1]);return '\\x'+Array.from(bytes,c=>c.charCodeAt(0).toString(16).padStart(2,'0')).join('');},
initials(name){const parts=String(name||'User').trim().split(/\s+/);return (parts.length>1?parts[0][0]+parts[parts.length-1][0]:parts[0].slice(0,2)).toUpperCase();}
};
})();
