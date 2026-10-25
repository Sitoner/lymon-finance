import '../web/src/styles.css';

export const metadata = {
  title: 'Lymon Finanzas',
  icons: { icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><circle cx='16' cy='16' r='14' fill='%23c9d636'/><path d='M9 20l5-6 4 4 5-7' stroke='%23142' stroke-width='3' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>" },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
