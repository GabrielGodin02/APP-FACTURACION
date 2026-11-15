# Generar la APK (una sola vez)
Requisitos: Node 18+, Android Studio (trae Java y el SDK).

    npm install
    npx cap add android          # solo la primera vez
    npm run android              # abre Android Studio

En Android Studio: Build > Build Bundle(s)/APK(s) > Build APK(s).
La APK queda en android/app/build/outputs/apk/debug/app-debug.apk
(o usa `npm run apk` desde la terminal).

Permiso de cámara (escáner): en android/app/src/main/AndroidManifest.xml agrega
    <uses-permission android:name="android.permission.CAMERA" />
Para Play Store: Build > Generate Signed Bundle (AAB) y firma con tu keystore.
Icono: en Android Studio, clic derecho en res > New > Image Asset y usa icons/icon-512.png.
