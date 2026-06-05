package com.aylink.mobile

import android.app.Application
import com.aylink.mobile.data.repo.AppContainer

class AYLinkMobileApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}
