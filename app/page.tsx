import {redirect} from 'next/navigation';
import {getAppUser} from '../lib/auth';
import Dashboard from './dashboard';
export const dynamic='force-dynamic';
export default async function Page(){if(!await getAppUser())redirect('/login');return <Dashboard/>}
