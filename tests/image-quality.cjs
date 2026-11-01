const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {stripTypeScriptTypes} = require('node:module');
const png = require('fast-png');
const jpeg = require('jpeg-js');
const root = path.resolve(__dirname, '../supabase/functions/_shared');
function load(file, customRequire = require) {
  let source = fs.readFileSync(path.join(root,file),'utf8');
  source=source.replace("import jpeg from 'npm:jpeg-js@0.4.4';","const jpeg=require('jpeg-js');")
    .replace("import { decode } from 'npm:fast-png@6.2.0';","const {decode}=require('fast-png');")
    .replace("import { imageMetrics } from './image-metrics.ts';","const {imageMetrics}=require('./image-metrics.ts');");
  const exported = file==='image-metrics.ts'?'imageMetrics':'imageQuality';
  const code=stripTypeScriptTypes(source.replace('export function '+exported,'function '+exported),{mode:'strip'})+'\nexports.'+exported+'='+exported+';';
  const result = {}; new Function('require','exports',code)(customRequire,result);return result;
}
const metrics = load('image-metrics.ts');
const {imageQuality} = load('image-quality.ts', name => name === './image-metrics.ts' ? metrics : require(name.replace(/@\d.*$/,'')));
function image(width,height,mode='sharp') {
  const data = new Uint8Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const value=mode==='sharp'?((Math.floor(x/4)+Math.floor(y/4))%2?25:230):mode==='blank'?255:100+55*Math.sin(x/70)+45*Math.cos(y/80);
    const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=Math.round(value);data[i+3]=255;
  }
  return {width,height,channels:4,depth:8,data};
}
const sharp=image(400,400),soft=image(400,400,'soft'),blank=image(400,400,'blank');
const sharpPng=imageQuality(png.encode(sharp),'png',false);
assert.equal(sharpPng.rejected,false);
const blurry=imageQuality(png.encode(soft),'png',false);
assert.equal(blurry.rejected,true);assert.match(blurry.comment,/blurred|unclear/);
assert.equal(imageQuality(png.encode(blank),'png',false).rejected,true);
assert.equal(imageQuality(jpeg.encode(sharp,95).data,'jpg',false).rejected,false);
assert.equal(imageQuality(jpeg.encode(soft,80).data,'jpeg',false).rejected,true);
assert.equal(imageQuality(png.encode(image(300,300)),'png',true).rejected,false);
assert.equal(imageQuality(png.encode(image(200,200)),'png',true).rejected,true);
assert.equal(imageQuality(png.encode(image(300,450)),'png',true).rejected,true);
assert.equal(imageQuality(Buffer.from('%PDF-1.4'),'pdf',false).checked,false);
const huge=Buffer.from(png.encode(sharp));huge.writeUInt32BE(50000,16);huge.writeUInt32BE(50000,20);
assert.throws(()=>imageQuality(huge,'png',false),/16 megapixels/);
console.log('PASS: sharp JPG/PNG accepted, blurred/blank images rejected, ID square/dimension rules enforced, PDF stays manual, oversized image decode blocked.', {sharpVariance:sharpPng.variance,blurVariance:blurry.variance});
