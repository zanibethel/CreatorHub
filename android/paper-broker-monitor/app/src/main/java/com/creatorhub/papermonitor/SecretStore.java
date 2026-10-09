package com.creatorhub.papermonitor;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** App-private settings; broker keys and ingest token are encrypted by Android Keystore. */
final class SecretStore {
    private static final String PREFS = "paper_monitor_settings";
    private static final String ALIAS = "creatorhub_paper_monitor_v1";
    private final SharedPreferences prefs;

    SecretStore(Context ctx) { prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }
    boolean enabled() { return prefs.getBoolean("enabled", false); }
    void enabled(boolean enabled) { prefs.edit().putBoolean("enabled", enabled).apply(); }

    private static SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        SecretKey prior = (SecretKey) store.getKey(ALIAS, null);
        if (prior != null) return prior;
        KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        gen.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).build());
        return gen.generateKey();
    }
    private static String seal(String plain) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] iv = cipher.getIV(), data = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        byte[] out = new byte[iv.length + data.length];
        System.arraycopy(iv,0,out,0,iv.length);
        System.arraycopy(data,0,out,iv.length,data.length);
        return Base64.encodeToString(out, Base64.NO_WRAP);
    }
    private static String open(String sealed) throws Exception {
        byte[] bytes = Base64.decode(sealed, Base64.NO_WRAP);
        if (bytes.length < 29) throw new IllegalArgumentException("Ciphertext invalid");
        byte[] iv = new byte[12], data = new byte[bytes.length-12];
        System.arraycopy(bytes,0,iv,0,12);
        System.arraycopy(bytes,12,data,0,data.length);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,iv));
        return new String(cipher.doFinal(data),StandardCharsets.UTF_8);
    }
    void save(String keyId, String secret, String token) throws Exception {
        if(keyId.isEmpty() || secret.isEmpty() || !token.matches("[a-f0-9]{64}"))
            throw new IllegalArgumentException("Enter PAPER credentials and a 64-character hex ingest token.");
        String e1=seal(keyId.trim()),e2=seal(secret.trim()),e3=seal(token);
        if(!prefs.edit().putString("key",e1).putString("secret",e2).putString("token",e3).commit())
            throw new IllegalStateException("Could not save private settings.");
    }
    String[] read() throws Exception {
        String a=prefs.getString("key",null),b=prefs.getString("secret",null),c=prefs.getString("token",null);
        if(a==null || b==null || c==null)throw new IllegalStateException("Configure private PAPER credentials first.");
        return new String[]{open(a),open(b),open(c)};
    }
    static String newToken() {
        byte[] bytes = new byte[32];new SecureRandom().nextBytes(bytes);
        return hex(bytes);
    }
    static String digest(String raw) {
        try { return hex(MessageDigest.getInstance("SHA-256").digest(raw.getBytes(StandardCharsets.UTF_8))); }
        catch(Exception error){ throw new IllegalStateException(error); }
    }
    private static String hex(byte[] bytes) {
        StringBuilder out = new StringBuilder(bytes.length*2);
        for(byte b:bytes)out.append(String.format(java.util.Locale.ROOT,"%02x",b&255));
        return out.toString();
    }
}
