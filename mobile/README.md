# The Good Earth mobile app

An Android-first Expo app for the existing shop. It reads the live Supabase product catalog, signs into the existing customer account, synchronizes the signed-in bag with the website through Supabase Realtime, and submits orders through the existing `create-order` Edge Function.

## One-time Supabase setup

1. Open the Supabase project for The Good Earth and select **SQL Editor**.
2. Run the migration in `../supabase/migrations/20261006000000_shared_cart.sql`. It creates the per-customer bag table, restricts access with row-level security, and adds the table to Realtime.
3. In Supabase, open **Authentication → URL Configuration → Redirect URLs**. Add this URL exactly: `thegoodearth://auth/callback`. Keep the existing website redirect URLs.
4. The Google provider uses the Supabase OAuth callback. The mobile return URL above belongs in Supabase’s allowed redirect URLs; it is not a new Google JavaScript origin.

## Install and run the app

1. Install Node.js LTS on the development computer.
2. In a terminal, enter the `mobile` folder.
3. Copy `.env.example` to `.env` and fill in the same Supabase project URL and publishable key used by `site/config.js`. These are public client settings; never put a Supabase secret/service-role key or Mailgun key in the app.
4. Run `npm install`.
5. Run `npx expo install --fix` to align Expo modules with the Expo SDK in `package.json`.
6. Sign in to Expo with `npx eas-cli login`, then link this project with `npx eas-cli init`.
7. Add `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to the Expo project’s environment variables for the **preview** environment.
8. Build the installable Android preview: `npx eas-cli build --platform android --profile preview`.
9. When Expo finishes the build, open its APK link on an Android phone and install it. A Google sign-in callback uses this app’s `thegoodearth://` URL scheme, so test with this installed build rather than relying on Expo Go.

The same account’s signed-in bag is stored in `public.shopping_cart_items`. A visitor who is not signed in can still use a device-local bag; signing in merges that bag into the account bag. The mobile and web apps refresh their display when the shared rows change. Checkout continues to use the existing order function, so the server remains responsible for validating current product prices and sending Mailgun email.

## Phone test checklist

- Sign into the same Google account on the website and Android app.
- Add one product on the website; it should appear in the app after the live update arrives.
- Change its quantity in the app; verify the web bag changes too.
- Sign out and sign in as a different account; it should not show the first customer’s bag.
- Place a clearly identified test order and confirm it appears in Supabase and sends the order email.
