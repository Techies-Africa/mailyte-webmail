import type { Metadata } from 'next';
import ConnectApprove from './ConnectApprove';

export const metadata: Metadata = {
  title: 'Connect an app',
  robots: { index: false, follow: false },
};

/**
 * Where ChatGPT, Claude and other AI apps send a person to approve them
 * (the mail server's OAuth discovery names this page). Everything happens in
 * the browser against /api/webmail/connect/authorize; no analytics here.
 */
export default function ConnectAuthorizePage() {
  return <ConnectApprove />;
}
