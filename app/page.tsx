import { redirect } from 'next/navigation';

/**
 * This app is only a webmail, so the root is not a landing page -- it is a
 * redirect to the mailbox. Serving a 404 at `/` would make a deployment look
 * broken to anyone who visits the bare hostname.
 */
export default function Home() {
  redirect('/webmail');
}
