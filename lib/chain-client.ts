'use client';
// Browser side of the Sepolia integration: MetaMask for transactions, and an independent on-chain check
// that reads the contracts directly from a public node (our server is not trusted for the answer).
import {CHAIN_ID_HEX,ethCall,encodeNftVerify,encodeAnchorVerify,decodeNftVerify,decodeAnchorVerify,tokenIdFromCode} from './chain.mjs';
const eth=()=>{const p=(globalThis as any).ethereum;if(!p)throw Error('MetaMask bulunamadı. Sayfayı MetaMask’ın kurulu olduğu tarayıcı profilinde açın.');return p;};
export async function connectWallet(){
 const p=eth();
 const accounts:string[]=await p.request({method:'eth_requestAccounts'});
 if(!accounts?.[0])throw Error('MetaMask hesabı seçilmedi.');
 if(await p.request({method:'eth_chainId'})!==CHAIN_ID_HEX){
  try{await p.request({method:'wallet_switchEthereumChain',params:[{chainId:CHAIN_ID_HEX}]});}
  catch{throw Error('MetaMask’ta Sepolia ağını seçin ve tekrar deneyin.');}
 }
 return accounts[0];
}
export async function sendTransaction(from:string,to:string,data:string):Promise<string>{
 try{return await eth().request({method:'eth_sendTransaction',params:[{from,to,data}]});}
 catch(e:any){if(e?.code===4001)throw Error('İşlem MetaMask’ta reddedildi.');throw Error(e?.message||'İşlem gönderilemedi.');}
}
export type ChainRecord={method:'nft'|'anchor',code:string,vcHash:string,proof:string[],txHash:string,blockTime:number,contract:string,tokenId:string|null,onChain:any,error:string|null};
// Re-reads one record straight from Sepolia. Returns null when the public node cannot be reached.
export async function independentCheck(rpcUrl:string,r:ChainRecord,hash=r.vcHash){
 try{
  const out=r.method==='nft'?await ethCall(rpcUrl,r.contract,encodeNftVerify(tokenIdFromCode(r.code),hash)):await ethCall(rpcUrl,r.contract,encodeAnchorVerify(hash,r.proof));
  return r.method==='nft'?decodeNftVerify(out):decodeAnchorVerify(out);
 }catch{return null;}
}
export const methodLabel=(m:string)=>m==='nft'?'Yöntem 1 · NFT (her diploma bir token)':'Yöntem 2 · Merkle kökü (toplu kayıt)';
export const shortHash=(h:string)=>h&&h.length>18?h.slice(0,10)+'…'+h.slice(-6):h;
