import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ch.schaerholzbau.bcfonsite',
  appName: 'BCF-OnSite',
  webDir: 'dist',
  backgroundColor: '#121417',
  android: {
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
    // BimCollab login pages are opened inside the app so the OAuth redirect lands back here
    allowNavigation: ['*.bimcollab.com', 'bimcollab.com', 'accounts.google.com', '*.supabase.co'],
  },
  plugins: {
    // Native HTTP avoids CORS restrictions when talking to the BimCollab BCF API
    CapacitorHttp: { enabled: true },
  },
};

export default config;
