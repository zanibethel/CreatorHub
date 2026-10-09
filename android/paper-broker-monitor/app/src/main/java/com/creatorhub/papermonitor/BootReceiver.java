package com.creatorhub.papermonitor;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Restart only when the owner explicitly enabled PAPER monitoring earlier. */
public final class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context,Intent intent){
        if(!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction()))return;
        try{
            if(!new SecretStore(context).enabled())return;
            Intent start=new Intent(context,PaperStreamService.class);
            start.setAction(PaperStreamService.START);
            context.startForegroundService(start);
        }catch(Exception ignored){
            // Foreground-service restrictions differ by Android OS.
            // Status must be verified after reboot, never falsely marked connected.
        }
    }
}
