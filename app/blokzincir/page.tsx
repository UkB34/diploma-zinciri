import {redirect} from 'next/navigation';
import {getAppUser} from '../../lib/auth';
import ChainLab from './lab';
export const dynamic='force-dynamic';
export const metadata={title:'Blokzincir testi | Diploma Zinciri',robots:{index:false,follow:false}};
export default async function Page(){if(!await getAppUser())redirect('/login?next=/blokzincir');return <ChainLab/>;}
