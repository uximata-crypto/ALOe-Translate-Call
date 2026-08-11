import './globals.css';

export const metadata = {
  title: 'ALOe Translate Call',
  description: 'Chamadas internas com tradução de voz em tempo real — Português como língua principal.',
  manifest: '/manifest.webmanifest',
  themeColor: '#0d1821',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'ALOe Translate',
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-PT">
      <body>{children}</body>
    </html>
  );
}
