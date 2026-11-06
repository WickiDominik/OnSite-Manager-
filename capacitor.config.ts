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
    // Login pages (BimCollab, Microsoft for OneDrive) are opened inside the app so the OAuth redirect lands back here
    allowNavigation: [
      '*.bimcollab.com',
      'bimcollab.com',
      'accounts.google.com',
      '*.supabase.co',
      'login.microsoftonline.com',
      'login.microsoft.com',
      'login.live.com',
      'account.live.com',
      'account.microsoft.com',
    ],
  },
  plugins: {
    // Native HTTP avoids CORS restrictions when talking to the BimCollab BCF API
    CapacitorHttp: { enabled: true },
  },
};

export default config;
