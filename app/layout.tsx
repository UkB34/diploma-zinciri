import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'Diploma Zinciri | Onay ve İzlenebilirlik',description:'Sıralı diploma onayı, belge sürümleri ve izlenebilir işlem geçmişi. Özel test prototipi.'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="tr"><body>{children}</body></html>}
