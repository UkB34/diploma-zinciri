import Diploma from '../view';
export const metadata={title:'Dijital Diploma | Diploma Zinciri',robots:{index:false,follow:false},referrer:'no-referrer' as const};
export default async function Page({params}:{params:Promise<{code:string}>}){const {code}=await params;return <Diploma code={code}/>;}
