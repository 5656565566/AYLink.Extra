package com.aylink.mobile

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import com.aylink.mobile.ui.AYLinkApp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val container = (application as AYLinkMobileApp).container
        setContent {
            AYLinkApp(container = container)
        }
    }
}
