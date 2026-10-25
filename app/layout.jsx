import { Inter, Oswald } from 'next/font/google';
import '../web/src/styles.css';

// Oswald: la tipografía de titulares de lymon.es; Inter para el texto y las cifras
const marca = Oswald({ subsets: ['latin'], weight: ['500', '600'], variable: '--font-marca' });
const texto = Inter({ subsets: ['latin'], variable: '--font-texto' });

export const metadata = {
  title: 'Lymon Finanzas',
  robots: { index: false, follow: false },
};

export const viewport = { themeColor: '#2d2d2e' };

export default function RootLayout({ children }) {
  return (
    <html lang="es" className={`${marca.variable} ${texto.variable}`}>
      <body>{children}</body>
    </html>
  );
}
