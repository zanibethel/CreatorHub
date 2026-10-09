package com.creatorhub.papermonitor;

import android.app.*;
import android.content.*;
import android.os.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import okhttp3.*;
import okio.ByteString;

/** Read-only Alpaca PAPER trade_updates subscriber. No order endpoints. */
public final class PaperStreamService extends Service {
    public static final String START="com.creatorhub.papermonitor.START";
    public static final String STOP="com.creatorhub.papermonitor.STOP";
    private static final String STREAM="wss://paper-api.alpaca.markets/stream";
    private static final String INGEST="https://yufptpfiwdbzzrvhkvux.supabase.co/functions/v1/paper-trade-stream-ingest";
    private static final String CHANNEL="paper_monitor_service";
    public static volatile String status="Stopped",detail="No broker subscription.";
    private final ExecutorService serial=Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService timer=Executors.newSingleThreadScheduledExecutor();
    private final AtomicLong sequence=new AtomicLong();
    private OkHttpClient client;
    private WebSocket socket;
    private PowerManager.WakeLock wakeLock;
    private SecretStore store;
    private File spool;
    private String[] keys;
    private String session=UUID.randomUUID().toString();
    private int reconnects=0;
    private boolean subscribed=false,stopped=false,connecting=false;
    private long nextConnect=0,lastHeartbeat=0;
    private boolean flushing=false, tickerScheduled=false;

    @Override public void onCreate(){
        super.onCreate();
        store=new SecretStore(this);
        spool=new File(getFilesDir(),"paper-broker-events");
        if(!spool.exists()&&!spool.mkdirs())status="Storage unavailable";
        client=new OkHttpClient.Builder().pingInterval(20,TimeUnit.SECONDS)
                .connectTimeout(15,TimeUnit.SECONDS).readTimeout(0,TimeUnit.SECONDS)
                .callTimeout(0,TimeUnit.SECONDS).build();
        NotificationManager mgr=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);
        mgr.createNotificationChannel(new NotificationChannel(CHANNEL,"PAPER broker monitoring",NotificationManager.IMPORTANCE_LOW));
        startForeground(1128,notification("Starting PAPER monitor"));
    }
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(intent!=null && STOP.equals(intent.getAction())){
            store.enabled(false);status="Stopped";stopSelf();return START_NOT_STICKY;
        }
        if(!store.enabled()){stopSelf();return START_NOT_STICKY;}
        serial.execute(()->{
            try {
                keys=store.read();
                if(!spool.isDirectory())throw new IllegalStateException("Secure spool unavailable.");
                PowerManager pm=(PowerManager)getSystemService(POWER_SERVICE);
                if(wakeLock==null){wakeLock=pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"creatorhub:paper_stream");wakeLock.acquire();}
                status="Connecting";detail="PAPER WebSocket only";display();
                nextConnect=0;
                tick();
            }catch(Exception ex){status="Setup required";detail="Credentials or private storage unavailable";display();stopSelf();}
        });
        if(!tickerScheduled){
            tickerScheduled=true;
            timer.scheduleAtFixedRate(()->serial.execute(this::tick),5,5,TimeUnit.SECONDS);
        }
        return START_STICKY;
    }
    private Notification notification(String message){
        Intent i=new Intent(this,MainActivity.class);
        PendingIntent tap=PendingIntent.getActivity(this,0,i,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(this,CHANNEL).setSmallIcon(android.R.drawable.stat_notify_sync)
                .setContentTitle("CreatorHub · PAPER Monitor")
                .setContentText(message).setContentIntent(tap).setOngoing(true).build();
    }
    private void display(){
        ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).notify(1128,notification(status+" · "+detail));
    }
    private void tick(){
        if(stopped||!store.enabled()||keys==null)return;
        long now=System.currentTimeMillis();
        if(!subscribed&&!connecting&&now>=nextConnect)connect();
        if(now-lastHeartbeat>=20000){lastHeartbeat=now;flush(true);}
        else if(queueSize()>0)flush(false);
    }
    private void connect(){
        connecting=true;status="Connecting";detail="Authorizing PAPER stream";display();
        Request request=new Request.Builder().url(STREAM).build();
        socket=client.newWebSocket(request,new WebSocketListener(){
            @Override public void onOpen(WebSocket ws,Response response){
                serial.execute(()->{
                    if(stopped)return;
                    try{
                        JSONObject msg=new JSONObject().put("action","auth")
                          .put("key",keys[0]).put("secret",keys[1]);
                        ws.send(msg.toString());
                    }catch(Exception ex){disconnect("Authentication request failed");}
                });
            }
            @Override public void onMessage(WebSocket ws,String message){serial.execute(()->receive(message));}
            @Override public void onMessage(WebSocket ws,ByteString bytes){
                // Alpaca PAPER emits binary WebSocket frames containing JSON.
                serial.execute(()->receive(bytes.utf8()));
            }
            @Override public void onClosed(WebSocket ws,int code,String reason){
                serial.execute(()->{if(socket==ws)disconnect("Socket closed; coverage gap");});
            }
            @Override public void onFailure(WebSocket ws,Throwable problem,Response response){
                serial.execute(()->{if(socket==ws)disconnect("Socket failed; coverage gap");});
            }
        });
    }
    private void receive(String wire){
        if(stopped)return;
        try{
            String trimmed=wire.trim();
            JSONArray arr=trimmed.startsWith("[")?new JSONArray(trimmed):new JSONArray().put(new JSONObject(trimmed));
            for(int i=0;i<arr.length();i++){
                JSONObject frame=arr.getJSONObject(i);
                String name=frame.optString("stream","");
                JSONObject data=frame.optJSONObject("data");
                if(data==null)continue;
                if("authorization".equals(name)){
                    if(!"authorized".equals(data.optString("status")))throw new IllegalStateException("Alpaca PAPER authorization refused");
                    JSONObject msg=new JSONObject().put("action","listen").put("data",
                        new JSONObject().put("streams",new JSONArray().put("trade_updates")));
                    socket.send(msg.toString());
                } else if("listening".equals(name)){
                    JSONArray channels=data.optJSONArray("streams");
                    boolean found=false;
                    if(channels!=null)for(int j=0;j<channels.length();j++)
                        if("trade_updates".equals(channels.optString(j)))found=true;
                    if(!found)throw new IllegalStateException("Alpaca stream subscription refused");
                    subscribed=true;connecting=false; // retain reconnect count within this service session
                    status="PAPER connected";detail="Broker events subscribed; checking private delivery";
                    display();flush(true);
                } else if("trade_updates".equals(name)){
                    if(!subscribed)throw new IllegalStateException("Event before subscription acknowledgment");
                    persist(sanitize(frame)); // must fsync before any network acknowledgment
                    status="PAPER connected";detail="Broker event saved; pending private delivery";
                    display();flush(false);
                }
            }
        }catch(IOException ex){
            status="Private event storage failure";detail="Broker coverage gap; local spool unavailable";
            display();disconnect("Local event storage unavailable; coverage gap");
        }catch(Exception ex){
            status="Broker frame error";detail="Connection reset; inspect compatibility";
            display();disconnect("Malformed/unrecognized broker frame");
        }
    }
    private static final String[] DATA={"event","execution_id","event_id","timestamp","at","qty","price","position_qty"};
    private static final String[] ORDER={"id","client_order_id","symbol","side","status","type",
        "order_class","qty","filled_qty","stop_price","limit_price","updated_at","canceled_at",
        "replaced_at","filled_at","cancel_requested_at","replaces","replaced_by"};
    private static JSONObject allow(JSONObject value,String[] keys) throws JSONException {
        JSONObject result=new JSONObject();
        for(String key:keys)if(value.has(key))result.put(key,value.get(key));
        return result;
    }
    private static JSONObject sanitize(JSONObject frame) throws JSONException {
        JSONObject data=frame.getJSONObject("data"),order=data.getJSONObject("order");
        if(!data.has("event")||!order.has("id")||!order.has("symbol"))
            throw new JSONException("Missing required broker event identity");
        return new JSONObject().put("stream","trade_updates").put("data",
                allow(data,DATA).put("order",allow(order,ORDER)));
    }
    private void persist(JSONObject event) throws IOException {
        File[] all=spool.listFiles((dir,name)->name.endsWith(".json"));
        if(all==null||all.length>=20000)throw new IOException("Private broker spool full.");
        String name=String.format(Locale.ROOT,"%013d-%08d-%s",System.currentTimeMillis(),
                sequence.incrementAndGet(),UUID.randomUUID());
        File staging=new File(spool,name+".tmp"),destination=new File(spool,name+".json");
        byte[] data=event.toString().getBytes(StandardCharsets.UTF_8);
        try(FileOutputStream out=new FileOutputStream(staging)){
            out.write(data);out.getFD().sync();
        }
        if(!staging.renameTo(destination))throw new IOException("Could not commit broker event.");
    }
    private File[] batch(){
        File[] all=spool.listFiles((dir,name)->name.endsWith(".json"));
        if(all==null)return new File[0];
        Arrays.sort(all,Comparator.comparing(File::getName));
        return Arrays.copyOf(all,Math.min(50,all.length));
    }
    private int queueSize(){
        File[] all=spool.listFiles((dir,name)->name.endsWith(".json"));
        return all==null?0:all.length;
    }
    private void flush(boolean heartbeat){
        if(flushing || keys==null || stopped)return;
        File[] files=batch();
        if(files.length==0&&!heartbeat)return;
        flushing=true;
        try{
            JSONArray events=new JSONArray();
            for(File file:files)events.put(new JSONObject(new String(Files.readAllBytes(file.toPath()),StandardCharsets.UTF_8)));
            JSONObject body=new JSONObject().put("sessionId",session).put("connected",subscribed)
               .put("reconnects",reconnects).put("events",events);
            Request req=new Request.Builder().url(INGEST).addHeader("x-paper-stream-token",keys[2])
                .post(RequestBody.create(body.toString(),MediaType.get("application/json"))).build();
            Call call=client.newCall(req);
            call.timeout().timeout(12,TimeUnit.SECONDS);
            try(Response res=call.execute()){
                if(res.code()==401||res.code()==403)
                    throw new SecurityException("Private ingest token rejected");
                if(!res.isSuccessful())throw new IOException("Private ingestion unavailable (HTTP "+res.code()+")");
                ResponseBody responseBody=res.body();
                if(responseBody==null)throw new IOException("Missing receipt");
                JSONObject ack=new JSONObject(responseBody.string());
                if(!ack.optBoolean("ok")||ack.optInt("accepted",-1)!=files.length)
                    throw new IOException("Private delivery not confirmed");
                for(File file:files)if(!file.delete())throw new IOException("Acknowledged file deletion failed");
                if(subscribed){
                    status="PAPER connected";
                    detail=queueSize()==0?"Supabase delivery confirmed":"Delivering buffered broker events";
                    display();
                }
            }
        }catch(Exception error){
            detail=error instanceof SecurityException
                ?"Supabase ingest authentication rejected; retained local events"
                :"Local events retained; Supabase delivery unavailable";
            display();
        }finally{flushing=false;}
    }
    private void disconnect(String reason){
        if(stopped)return;
        subscribed=false;connecting=false;
        reconnects=Math.min(10000000,reconnects+1);
        long pause=Math.min(60000,1000L*(1L<<Math.min(reconnects,6)));
        nextConnect=System.currentTimeMillis()+pause;
        status="Reconnecting";detail=reason;display();
        if(socket!=null){WebSocket prior=socket;socket=null;prior.cancel();}
        flush(true); // explicitly report offline when delivery is available
    }
    @Override public void onDestroy(){
        stopped=true;status="Stopped";detail="Monitoring service stopped";
        if(socket!=null)socket.cancel();
        timer.shutdownNow();serial.shutdownNow();client.dispatcher().executorService().shutdown();
        if(wakeLock!=null&&wakeLock.isHeld())wakeLock.release();
        super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent){return null;}
}
