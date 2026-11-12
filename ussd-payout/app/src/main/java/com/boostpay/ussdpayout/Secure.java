package com.boostpay.ussdpayout;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * The PIN never lives in plain text on disk: it is sealed with an AES-GCM key
 * that is generated inside the Android Keystore and cannot be exported from the
 * device. Copying the prefs file to another phone therefore gives nothing.
 */
public final class Secure {

    private static final String PREFS = "bp_secure";
    private static final String KEY = "pin_sealed";       // legacy single-PIN slot
    private static final String ALIAS = "bp_pin_key_v1";

    private Secure() {}

    private static SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(ALIAS)) return (SecretKey) ks.getKey(ALIAS, null);
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        kg.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build());
        return kg.generateKey();
    }

    public static void savePin(Context c, String pin) {
        savePin(c, KEY, pin);
    }

    /** Seals a PIN under an arbitrary slot name (one slot per SIM). */
    public static void savePin(Context c, String slot, String pin) {
        SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (pin == null || pin.isEmpty()) { p.edit().remove(KEY_OF(slot)).apply(); return; }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key());
            byte[] iv = cipher.getIV();
            byte[] ct = cipher.doFinal(pin.getBytes("UTF-8"));
            byte[] blob = new byte[1 + iv.length + ct.length];
            blob[0] = (byte) iv.length;
            System.arraycopy(iv, 0, blob, 1, iv.length);
            System.arraycopy(ct, 0, blob, 1 + iv.length, ct.length);
            p.edit().putString(KEY_OF(slot), Base64.encodeToString(blob, Base64.NO_WRAP)).apply();
        } catch (Exception e) {
            p.edit().remove(KEY_OF(slot)).apply();
        }
    }

    public static String readPin(Context c) {
        return readPin(c, KEY);
    }

    public static String readPin(Context c, String slot) {
        String b64 = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_OF(slot), null);
        if (b64 == null) return "";
        try {
            byte[] blob = Base64.decode(b64, Base64.NO_WRAP);
            int ivLen = blob[0] & 0xff;
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, blob, 1, ivLen));
            return new String(cipher.doFinal(blob, 1 + ivLen, blob.length - 1 - ivLen), "UTF-8");
        } catch (Exception e) {
            return "";
        }
    }

    public static boolean hasPin(Context c) {
        return !readPin(c, KEY).isEmpty();
    }

    public static boolean hasPin(Context c, String slot) {
        return !readPin(c, slot).isEmpty();
    }

    private static String KEY_OF(String slot) { return "pin:" + slot; }
}
