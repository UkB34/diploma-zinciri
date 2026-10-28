import {redirect} from 'next/navigation';
import {getAppUser} from '../lib/auth';
import Dashboard from './dashboard';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{case?:string}>}){const params=await searchParams;const next=typeof params.case==='string'&&/^DZ-[A-F0-9]{8}$/.test(params.case)?'/?case='+params.case:'/';if(!await getAppUser())redirect('/login?next='+encodeURIComponent(next));return <Dashboard/>}
