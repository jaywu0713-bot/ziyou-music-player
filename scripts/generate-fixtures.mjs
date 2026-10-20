import {mkdir,writeFile} from 'node:fs/promises';
const folder=new URL('../tests/fixtures/',import.meta.url);await mkdir(folder,{recursive:true});
const rate=44100,seconds=7,frames=rate*seconds;const wav=Buffer.alloc(44+frames*4);
wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(2,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*4,28);wav.writeUInt16LE(4,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(frames*4,40);
for(let i=0;i<frames;i++){const value=Math.round(Math.sin(2*Math.PI*440*i/rate)*3276);wav.writeInt16LE(value,44+i*4);wav.writeInt16LE(value,46+i*4);}
await writeFile(new URL('tone.wav',folder),wav);
const dsdRate=2822400,dsdSeconds=7,n=dsdRate*dsdSeconds,block=4096,bytes=Math.ceil(n/8),blocks=Math.ceil(bytes/block),data=Buffer.alloc(blocks*block*2,0x69);
let acc=0;for(let i=0;i<n;i++){acc+=0.1*Math.sin(2*Math.PI*440*i/dsdRate);const bit=acc>=0?1:0;acc-=bit?1:-1;const byte=i>>3,base=Math.floor(byte/block)*block*2+byte%block;const mask=1<<(i%8);if(bit){data[base]|=mask;data[base+block]|=mask;}else{data[base]&=~mask;data[base+block]&=~mask;}}
const h=Buffer.alloc(92);h.write('DSD ');h.writeBigUInt64LE(28n,4);h.writeBigUInt64LE(BigInt(92+data.length),12);h.writeBigUInt64LE(0n,20);h.write('fmt ',28);h.writeBigUInt64LE(52n,32);h.writeUInt32LE(1,40);h.writeUInt32LE(0,44);h.writeUInt32LE(2,48);h.writeUInt32LE(2,52);h.writeUInt32LE(dsdRate,56);h.writeUInt32LE(1,60);h.writeBigUInt64LE(BigInt(n),64);h.writeUInt32LE(block,72);h.write('data',80);h.writeBigUInt64LE(BigInt(12+data.length),84);
await writeFile(new URL('tone.dsf',folder),Buffer.concat([h,data]));
await writeFile(new URL('broken.dsf',folder),Buffer.from('DSD this is deliberately corrupt'));
console.log('Generated local synthetic PCM and DSD fixtures (440 Hz, 7 seconds).');
