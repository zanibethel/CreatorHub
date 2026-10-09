package com.creatorhub.papermonitor;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/** Manual control; never contains trading order buttons or endpoints. */
public final class MainActivity extends Activity {
    private final Handler ui=new Handler(Looper.getMainLooper());
    private EditText keyId,secret,token;
    private TextView status;
    private SecretStore store;
    private final int cyan=Color.rgb(66,217,224),muted=Color.rgb(166,185,196);
    private final Runnable refresh=new Runnable() {
        @Override public void run() {
            if(status!=null) status.setText("Monitor: "+PaperStreamService.status+
                    "\n"+PaperStreamService.detail+
                    "\n\n"+(store.enabled()?"Auto-restart enabled":"Auto-restart disabled")+
                    "\nPAPER only · No buy/sell permissions");
            ui.postDelayed(this,2500);
        }
    };
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        store=new SecretStore(this);
        getWindow().setStatusBarColor(Color.rgb(9,20,31));
        getWindow().setNavigationBarColor(Color.rgb(9,20,31));
        ScrollView scroll=new ScrollView(this);
        scroll.setFillViewport(true);
        LinearLayout root=new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(36,46,36,32);
        root.setBackgroundColor(Color.rgb(10,25,38));
        scroll.addView(root);
        title(root,"CREATORHUB",26,cyan);
        title(root,"PAPER Broker Monitor",22,Color.WHITE);
        label(root,"Samsung node companion · real-time broker event capture only.");
        label(root,"Alpaca PAPER → Private event spool → CreatorHub Supabase");
        status=title(root,"Monitor: stopped",16,Color.WHITE);
        keyId=field(root,"Alpaca PAPER API key ID",true);
        secret=field(root,"Alpaca PAPER API secret",true);
        token=field(root,"Dedicated 64-character ingest token",true);
        addButton(root,"Generate new ingest token",()->{
            token.setText(SecretStore.newToken());
            labelNotice("New token generated locally. Save and install its SHA-256 digest in Supabase before starting.");
        });
        addButton(root,"Copy SHA-256 digest for Supabase",()->{
            try{
                String raw=token.getText().toString().trim();
                if(raw.isEmpty())raw=store.read()[2];
                if(!raw.matches("[a-f0-9]{64}"))throw new Exception("Generate a valid token first.");
                String hash=SecretStore.digest(raw);
                ClipboardManager c=(ClipboardManager)getSystemService(Context.CLIPBOARD_SERVICE);
                c.setPrimaryClip(ClipData.newPlainText("Supabase PAPER_STREAM_INGEST_TOKEN_SHA256",hash));
                labelNotice("Digest copied. Paste it into the Supabase Edge Function secret PAPER_STREAM_INGEST_TOKEN_SHA256. Clipboard may be visible to Android apps.");
            }catch(Exception e){ labelNotice(e.getMessage()); }
        });
        addButton(root,"Save and START monitoring",()->{
            try{
                String a=keyId.getText().toString().trim(),b=secret.getText().toString().trim(),
                  c=token.getText().toString().trim();
                if(!a.isEmpty()||!b.isEmpty()||!c.isEmpty()){
                    if(a.isEmpty()||b.isEmpty()||c.isEmpty())
                        throw new IllegalArgumentException("Enter all three fields or leave all blank to use saved values.");
                    store.save(a,b,c);
                }
                store.read(); // proves encryption is available
                store.enabled(true);
                Intent i=new Intent(this,PaperStreamService.class);
                i.setAction(PaperStreamService.START);
                startForegroundService(i);
                labelNotice("Starting PAPER monitoring. Confirm broker subscription and Supabase heartbeats.");
            }catch(Exception e){ labelNotice("Not started: "+e.getMessage()); }
        });
        addButton(root,"STOP monitoring",()->{
            store.enabled(false);
            Intent i=new Intent(this,PaperStreamService.class);
            i.setAction(PaperStreamService.STOP);
            startService(i);
            labelNotice("Stop requested. This never cancels a broker order.");
        });
        label(root,"Manual sideload alpha. Keep the app's foreground notification running, allow background operation, and test reboot and Wi-Fi recovery before relying on it.");
        label(root,"The server ingestion digest is deliberately NOT configured by this APK. Do not paste API secrets into chat.");
        setContentView(scroll);
        if(Build.VERSION.SDK_INT>=33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=
                android.content.pm.PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},123);
    }
    private TextView title(LinearLayout root,String value,int sp,int color){
        TextView t=new TextView(this);t.setText(value);t.setTextSize(sp);t.setTextColor(color);
        t.setPadding(0,14,0,16);root.addView(t);return t;
    }
    private void label(LinearLayout root,String value){ title(root,value,13,muted); }
    private EditText field(LinearLayout root,String hint,boolean sensitive){
        EditText t=new EditText(this);t.setSingleLine(true);t.setHint(hint);t.setTextColor(Color.WHITE);
        t.setHintTextColor(muted);
        t.setBackgroundTintList(android.content.res.ColorStateList.valueOf(cyan));
        t.setInputType(sensitive?InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD:
                InputType.TYPE_CLASS_TEXT);
        root.addView(t,new LinearLayout.LayoutParams(-1,-2));return t;
    }
    private void addButton(LinearLayout root,String caption,Runnable action){
        Button b=new Button(this);b.setText(caption);b.setAllCaps(false);
        b.setTextColor(Color.rgb(5,25,36));b.setBackgroundTintList(
                android.content.res.ColorStateList.valueOf(cyan));
        LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.topMargin=14;
        root.addView(b,p);b.setOnClickListener(v->action.run());
    }
    private void labelNotice(String text){
        new AlertDialog.Builder(this).setTitle("PAPER Monitor").setMessage(text)
                .setPositiveButton("OK",null).show();
    }
    @Override public void onResume(){ super.onResume();ui.post(refresh); }
    @Override public void onPause(){ui.removeCallbacks(refresh);super.onPause();}
}
