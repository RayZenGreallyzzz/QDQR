package com.phoenix.qdqr.meshworkshop;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeFileSavePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
