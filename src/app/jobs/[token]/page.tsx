import JobPostForm from '@/components/JobPostForm';
import { publicRpc } from '@/lib/public-rpc';
type Props = { params: Promise<{token: string}> };
export async function generateMetadata({params}: Props) {
  const {token} = await params;
  try {
    const post = await publicRpc<{title: string; company: {name: string}}>('ats_public_jobs_open', {p_token: token});
    const title = post.title + ' | ' + post.company.name;
    const description = 'Explore available job positions and locations. Apply with your basic information.';
    return {title, description, openGraph: {title, description, type: 'website'}};
  } catch { return {title: 'Job openings', description: 'Explore available positions and apply.'}; }
}
export default async function JobsPostPage({params}: Props) {
  const {token} = await params;
  return <JobPostForm token={token} />;
}
