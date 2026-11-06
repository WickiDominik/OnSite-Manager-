package ch.schaerholzbau.bcfonsite;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // app-local plugins must be registered before the bridge starts
        registerPlugin(CloudHttpPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
