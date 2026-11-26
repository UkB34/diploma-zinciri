import {getAppUser} from '../../../lib/auth';
import {json} from '../../../lib/server-utils';
import {listGraduates} from '../../../lib/mezunlar';
export const dynamic='force-dynamic';
export async function GET(){
 const user=await getAppUser();if(!user)return json({error:'Oturum gerekli.'},401);
 const canMint=user.role==='central';
 return json({canMint,graduates:await listGraduates(canMint)});
}
