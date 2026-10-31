package com.aylink.mobile.ui

import android.graphics.Color
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.NavigationDrawerItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.LocalViewModelStoreOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import com.aylink.mobile.data.repo.AppContainer
import com.aylink.mobile.ui.devices.AppManagerOptionsMenu
import com.aylink.mobile.ui.devices.AppManagerScreen
import com.aylink.mobile.ui.devices.AppManagerViewModel
import com.aylink.mobile.ui.devices.DeviceListOptionsMenu
import com.aylink.mobile.ui.devices.DeviceListScreen
import com.aylink.mobile.ui.devices.DeviceListViewModel
import com.aylink.mobile.ui.devices.FileManagerOptionsMenu
import com.aylink.mobile.ui.devices.FileManagerScreen
import com.aylink.mobile.ui.devices.FileManagerViewModel
import com.aylink.mobile.ui.login.AddressSetupScreen
import com.aylink.mobile.ui.login.LoginScreen
import com.aylink.mobile.ui.login.LoginViewModel
import com.aylink.mobile.ui.remote.RemoteScreen
import com.aylink.mobile.ui.remote.RemoteViewModel
import com.aylink.mobile.ui.settings.SettingsScreen
import com.aylink.mobile.ui.terminal.TerminalBackgroundColor
import com.aylink.mobile.ui.terminal.TerminalOptionsMenu
import com.aylink.mobile.ui.terminal.TerminalScreen
import com.aylink.mobile.ui.terminal.TerminalViewModel
import com.aylink.mobile.ui.theme.AYLinkTheme
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainLayout(
    currentScreen: Screen,
    selectedDevice: com.aylink.mobile.data.model.Device?,
    onNavigate: (Screen) -> Unit,
    onLogout: () -> Unit,
    actions: @Composable RowScope.() -> Unit = {},
    // 终端全屏时由终端状态统一关闭顶部栏，其他页面不受影响。
    terminalChromeVisible: Boolean = true,
    content: @Composable () -> Unit,
) {
    fun currentDeviceOrNull(): com.aylink.mobile.data.model.Device? =
        when (currentScreen) {
            is Screen.AppManager -> currentScreen.device
            is Screen.FileManager -> currentScreen.device
            is Screen.Terminal -> currentScreen.device
            is Screen.Remote -> currentScreen.device
            is Screen.Devices -> selectedDevice
            else -> null
        }

    val drawerState = rememberDrawerState(initialValue = DrawerValue.Closed)
    val scope = rememberCoroutineScope()

    BackHandler(enabled = drawerState.isOpen) {
        scope.launch { drawerState.close() }
    }

    ModalNavigationDrawer(
        drawerState = drawerState,
        // 注意：Material3 的 gesturesEnabled 同时控制拖拽手势和点击遮罩关闭（Scrim.onClose 里
        // 也读它），终端页一旦把它置 false，侧边栏就打不开了，所以这里必须保持 true。
        // 终端页的防误触改由 TerminalScreen 的空格键输入区自己处理，不依赖这个开关。
        gesturesEnabled = true,
        drawerContent = {
            ModalDrawerSheet(
                modifier = Modifier.width(280.dp),
            ) {
                Spacer(Modifier.height(12.dp))
                Text(
                    "AYLink",
                    modifier = Modifier.padding(16.dp),
                    style = MaterialTheme.typography.titleLarge,
                )
                HorizontalDivider(modifier = Modifier.padding(bottom = 8.dp))

                NavigationDrawerItem(
                    icon = { Icon(Icons.Default.Home, contentDescription = null) },
                    label = { Text("首页 / 设备") },
                    selected = currentScreen is Screen.Devices || currentScreen is Screen.Remote,
                    onClick = {
                        scope.launch {
                            drawerState.close()
                            onNavigate(Screen.Devices)
                        }
                    },
                    modifier = Modifier.padding(NavigationDrawerItemDefaults.ItemPadding),
                )

                NavigationDrawerItem(
                    icon = { Icon(Icons.AutoMirrored.Filled.List, contentDescription = null) },
                    label = { Text("文件管理") },
                    selected = currentScreen is Screen.FileManager || currentScreen is Screen.FileManagerHome,
                    onClick = {
                        scope.launch {
                            drawerState.close()
                            currentDeviceOrNull()?.let { onNavigate(Screen.FileManager(it)) }
                                ?: onNavigate(Screen.FileManagerHome)
                        }
                    },
                    modifier = Modifier.padding(NavigationDrawerItemDefaults.ItemPadding),
                )

                NavigationDrawerItem(
                    icon = { Icon(Icons.Default.PlayArrow, contentDescription = null) },
                    label = { Text("应用管理") },
                    selected = currentScreen is Screen.AppManager || currentScreen is Screen.AppManagerHome,
                    onClick = {
                        scope.launch {
                            drawerState.close()
                            currentDeviceOrNull()?.let { onNavigate(Screen.AppManager(it)) }
                                ?: onNavigate(Screen.AppManagerHome)
                        }
                    },
                    modifier = Modifier.padding(NavigationDrawerItemDefaults.ItemPadding),
                )

                NavigationDrawerItem(
                    icon = { Icon(Icons.Default.Build, contentDescription = null) },
                    label = { Text("终端") },
                    selected = currentScreen is Screen.Terminal || currentScreen is Screen.TerminalHome,
                    onClick = {
                        scope.launch {
                            drawerState.close()
                            currentDeviceOrNull()?.let { onNavigate(Screen.Terminal(it)) }
                                ?: onNavigate(Screen.TerminalHome)
                        }
                    },
                    modifier = Modifier.padding(NavigationDrawerItemDefaults.ItemPadding),
                )

                NavigationDrawerItem(
                    icon = { Icon(Icons.Default.Settings, contentDescription = null) },
                    label = { Text("设置") },
                    selected = currentScreen is Screen.Settings,
                    onClick = {
                        scope.launch {
                            drawerState.close()
                            onNavigate(Screen.Settings)
                        }
                    },
                    modifier = Modifier.padding(NavigationDrawerItemDefaults.ItemPadding),
                )

                Spacer(Modifier.weight(1f))

                NavigationDrawerItem(
                    icon = { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = null) },
                    label = { Text("退出登录") },
                    selected = false,
                    onClick = {
                        scope.launch {
                            drawerState.close()
                            onLogout()
                        }
                    },
                    modifier = Modifier.padding(NavigationDrawerItemDefaults.ItemPadding),
                )
            }
        },
    ) {
        Scaffold(
            containerColor = if (currentScreen is Screen.Terminal) TerminalBackgroundColor else MaterialTheme.colorScheme.background,
            topBar = {
                if (terminalChromeVisible) {
                    TopAppBar(
                        title = {
                            Text(
                                when (currentScreen) {
                                    is Screen.Devices -> "设备列表"
                                    is Screen.Remote -> "远程控制"
                                    is Screen.AppManager -> "应用管理"
                                    Screen.AppManagerHome -> "应用管理"
                                    is Screen.FileManager -> "文件管理"
                                    Screen.FileManagerHome -> "文件管理"
                                    is Screen.Terminal -> "终端"
                                    Screen.TerminalHome -> "终端"
                                    is Screen.Settings -> "设置"
                                    else -> "AYLink"
                                },
                            )
                        },
                        navigationIcon = {
                            IconButton(onClick = { scope.launch { drawerState.open() } }) {
                                Icon(Icons.Default.Menu, contentDescription = "Menu")
                            }
                        },
                        actions = actions,
                    )
                }
            },
        ) { innerPadding ->
            Box(modifier = Modifier.padding(innerPadding).fillMaxSize()) {
                content()
            }
        }
    }
}

@Composable
fun AYLinkApp(container: AppContainer) {
    val sessionToken by container.sessionStore.token.collectAsStateWithLifecycle()
    val localSettings by container.localSettingsStore.settings.collectAsStateWithLifecycle()
    val lastSelectedDevice by container.sessionStore.lastSelectedDevice.collectAsStateWithLifecycle()
    val lastRemoteDevice by container.sessionStore.lastRemoteDevice.collectAsStateWithLifecycle()
    val sessionScopeKey = remember(sessionToken) { sessionToken ?: "logged-out" }
    val initialRemoteDevice = lastRemoteDevice
    var remoteScreenInstanceId by remember { mutableLongStateOf(0L) }
    var currentScreen by remember {
        mutableStateOf<Screen>(
            when {
                container.sessionStore.hasSession && localSettings.resumeLastRemote && initialRemoteDevice != null ->
                    Screen.Remote(
                        initialRemoteDevice,
                    )
                container.sessionStore.hasSession -> Screen.Devices
                container.sessionStore.hasConfiguredBaseUrl -> Screen.Login
                else -> Screen.AddressSetup
            },
        )
    }

    fun remoteScreen(
        device: com.aylink.mobile.data.model.Device,
        appPackageName: String? = null,
        appDisplayName: String? = null,
        newDisplay: Boolean = false,
    ): Screen.Remote {
        remoteScreenInstanceId += 1
        return Screen.Remote(
            device = device,
            appPackageName = appPackageName,
            appDisplayName = appDisplayName,
            newDisplay = newDisplay,
            instanceId = remoteScreenInstanceId,
        )
    }

    LaunchedEffect(sessionToken) {
        if (sessionToken.isNullOrBlank() && currentScreen !is Screen.AddressSetup && currentScreen !is Screen.Login) {
            currentScreen = Screen.Login
        }
    }

    val appContext = LocalContext.current.applicationContext
    val loginViewModel =
        rememberManagedViewModel("login-$sessionScopeKey") {
            LoginViewModel(
                authRepository = container.authRepository,
                sessionStore = container.sessionStore,
            )
        }

    AYLinkTheme(
        settings = localSettings,
        // 终端的状态栏位于主题 TopAppBar 上；只有投屏的顶部背景固定为黑色。
        statusBarStyle = if (currentScreen is Screen.Remote) SystemBarStyle.dark(Color.TRANSPARENT) else null,
        navigationBarStyle =
            when (currentScreen) {
                is Screen.Terminal -> SystemBarStyle.dark(TerminalBackgroundColor.toArgb())
                is Screen.Remote -> SystemBarStyle.dark(Color.BLACK)
                else -> null
            },
    ) {
        Surface(
            modifier = Modifier.fillMaxSize(),
            color = MaterialTheme.colorScheme.background,
        ) {
            if (currentScreen is Screen.AddressSetup || currentScreen is Screen.Login || currentScreen is Screen.Remote) {
                when (val screen = currentScreen) {
                    Screen.AddressSetup -> {
                        AddressSetupScreen(
                            viewModel = loginViewModel,
                            onBack =
                                if (container.sessionStore.hasConfiguredBaseUrl) {
                                    { currentScreen = Screen.Login }
                                } else {
                                    null
                                },
                            onContinue = { currentScreen = Screen.Login },
                        )
                    }

                    Screen.Login -> {
                        LoginScreen(
                            viewModel = loginViewModel,
                            onEditAddress = { currentScreen = Screen.AddressSetup },
                            onLoginSuccess = { currentScreen = Screen.Devices },
                        )
                    }

                    is Screen.Remote -> {
                        val viewModelStoreOwner = rememberDisposableViewModelStoreOwner(screen.instanceId)
                        val viewModel =
                            rememberManagedViewModel(
                                // 页面已有独立的 Store，刷新令牌不能在其中留下另一个播放会话。
                                key = "remote-${screen.device.id}-${screen.instanceId}",
                                viewModelStoreOwner = viewModelStoreOwner,
                            ) {
                                RemoteViewModel(
                                    appContext = appContext,
                                    device = screen.device,
                                    initialAppPackage = screen.appPackageName,
                                    initialAppName = screen.appDisplayName,
                                    initialNewDisplay = screen.newDisplay,
                                    deviceRepository = container.deviceRepository,
                                    sessionStore = container.sessionStore,
                                    localSettingsStore = container.localSettingsStore,
                                    okHttpClient = container.okHttpClient,
                                    json = container.json,
                                    appLogger = container.appLogger,
                                )
                            }
                        RemoteScreen(
                            device = screen.device,
                            viewModel = viewModel,
                            onBack = {
                                container.sessionStore.clearLastRemoteDevice()
                                currentScreen = Screen.Devices
                            },
                        )
                    }
                    else -> {}
                }
            } else {
                val deviceListViewModel =
                    if (currentScreen == Screen.Devices) {
                        rememberManagedViewModel("devices-$sessionScopeKey") {
                            DeviceListViewModel(container.deviceRepository)
                        }
                    } else {
                        null
                    }
                val appManagerScreen = currentScreen as? Screen.AppManager
                val appManagerViewModel =
                    appManagerScreen?.let { screen ->
                        rememberManagedViewModel("app-manager-$sessionScopeKey-${screen.device.id}") {
                            AppManagerViewModel(
                                device = screen.device,
                                deviceRepository = container.deviceRepository,
                            )
                        }
                    }
                val fileManagerScreen = currentScreen as? Screen.FileManager
                val fileManagerViewModel =
                    fileManagerScreen?.let { screen ->
                        rememberManagedViewModel("file-manager-$sessionScopeKey-${screen.device.id}") {
                            FileManagerViewModel(
                                deviceId = screen.device.id,
                                deviceRepository = container.deviceRepository,
                                localSettingsStore = container.localSettingsStore,
                            )
                        }
                    }
                val terminalViewModel =
                    (currentScreen as? Screen.Terminal)?.let { screen ->
                        rememberManagedViewModel("terminal-$sessionScopeKey-${screen.device.id}") {
                            TerminalViewModel(
                                device = screen.device,
                                sessionStore = container.sessionStore,
                                terminalTransport = container.terminalTransport,
                                json = container.json,
                            )
                        }
                    }
                // 顶部栏显隐由终端状态统一决定，非终端页不受全屏影响。
                val terminalChromeVisible = rememberTerminalChromeVisible(terminalViewModel)
                MainLayout(
                    currentScreen = currentScreen,
                    selectedDevice = lastSelectedDevice,
                    onNavigate = { currentScreen = it },
                    onLogout = {
                        container.sessionStore.clearSession()
                        currentScreen = Screen.Login
                    },
                    actions = {
                        deviceListViewModel?.let { DeviceListOptionsMenu(it) }
                        if (appManagerScreen != null && appManagerViewModel != null) {
                            AppManagerOptionsMenu(appManagerViewModel, appManagerScreen.device)
                        }
                        if (fileManagerScreen != null && fileManagerViewModel != null) {
                            FileManagerOptionsMenu(fileManagerViewModel, fileManagerScreen.device)
                        }
                        terminalViewModel?.let {
                            // 断开后回到未选择设备状态，终端页不再绑定这台设备。
                            TerminalOptionsMenu(it, onDisconnected = { currentScreen = Screen.TerminalHome })
                        }
                    },
                    terminalChromeVisible = terminalChromeVisible,
                ) {
                    when (val screen = currentScreen) {
                        Screen.Devices -> {
                            deviceListViewModel?.let { viewModel ->
                                DeviceListScreen(
                                    viewModel = viewModel,
                                    onEditAddress = {
                                        container.sessionStore.clearSession()
                                        currentScreen = Screen.AddressSetup
                                    },
                                    onLogout = {
                                        container.sessionStore.clearSession()
                                        currentScreen = Screen.Login
                                    },
                                    onOpenRemote = { device ->
                                        container.sessionStore.updateLastSelectedDevice(device)
                                        container.sessionStore.updateLastRemoteDevice(device)
                                        currentScreen = remoteScreen(device)
                                    },
                                    onOpenAppManager = { device ->
                                        container.sessionStore.updateLastSelectedDevice(device)
                                        currentScreen = Screen.AppManager(device)
                                    },
                                    onOpenFileManager = { device ->
                                        container.sessionStore.updateLastSelectedDevice(device)
                                        currentScreen = Screen.FileManager(device)
                                    },
                                    onOpenTerminal = { device ->
                                        container.sessionStore.updateLastSelectedDevice(device)
                                        currentScreen = Screen.Terminal(device)
                                    },
                                )
                            }
                        }
                        Screen.AppManagerHome -> {
                            FeatureEmptyScreen(
                                title = "还没有选中设备",
                                description = "从设备列表中选择一台设备后，再进入应用管理。",
                                onOpenDevices = { currentScreen = Screen.Devices },
                            )
                        }
                        is Screen.AppManager -> {
                            appManagerViewModel?.let { viewModel ->
                                AppManagerScreen(
                                    viewModel = viewModel,
                                    onOpenRemote = { device, appPackage, appName ->
                                        container.sessionStore.updateLastSelectedDevice(device)
                                        container.sessionStore.updateLastRemoteDevice(device)
                                        currentScreen =
                                            remoteScreen(
                                                device = device,
                                                appPackageName = appPackage,
                                                appDisplayName = appName,
                                                newDisplay = true,
                                            )
                                    },
                                )
                            }
                        }
                        Screen.FileManagerHome -> {
                            FeatureEmptyScreen(
                                title = "还没有选中设备",
                                description = "从设备列表中选择一台设备后，再进入文件管理。",
                                onOpenDevices = { currentScreen = Screen.Devices },
                            )
                        }
                        is Screen.FileManager -> {
                            fileManagerViewModel?.let { FileManagerScreen(viewModel = it) }
                        }
                        Screen.TerminalHome -> {
                            FeatureEmptyScreen(
                                title = "还没有选中设备",
                                description = "终端需要绑定具体设备。先去设备列表选择设备，再回来打开终端。",
                                onOpenDevices = { currentScreen = Screen.Devices },
                            )
                        }
                        is Screen.Terminal -> {
                            terminalViewModel?.let { TerminalScreen(viewModel = it) }
                        }
                        Screen.Settings -> {
                            SettingsScreen(
                                settingsStore = container.localSettingsStore,
                                logger = container.appLogger,
                                logExporter = container.diagnosticLogExporter,
                            )
                        }
                        else -> {}
                    }
                }
            }
        }
    }
}

@Composable
private inline fun <reified VM : ViewModel> rememberManagedViewModel(
    key: String,
    viewModelStoreOwner: ViewModelStoreOwner =
        LocalViewModelStoreOwner.current
            ?: error("No ViewModelStoreOwner was provided"),
    noinline creator: () -> VM,
): VM =
    viewModel(
        key = key,
        viewModelStoreOwner = viewModelStoreOwner,
        factory = managedViewModelFactory(creator),
    )

@Composable
private fun rememberDisposableViewModelStoreOwner(key: Any): ViewModelStoreOwner {
    val store = remember(key) { ViewModelStore() }
    DisposableEffect(store) {
        onDispose {
            store.clear()
        }
    }
    return remember(store) {
        object : ViewModelStoreOwner {
            override val viewModelStore: ViewModelStore = store
        }
    }
}

// 只在终端页创建 ViewModel，因此按是否存在分别收集；非终端页没有全屏状态。
@Composable
private fun rememberTerminalChromeVisible(viewModel: TerminalViewModel?): Boolean {
    if (viewModel == null) return true
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    return state.chromeVisible
}

private inline fun <reified VM : ViewModel> managedViewModelFactory(crossinline creator: () -> VM): ViewModelProvider.Factory =
    object : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            if (modelClass.isAssignableFrom(VM::class.java)) {
                return creator() as T
            }
            throw IllegalArgumentException("Unsupported ViewModel class: ${modelClass.name}")
        }
    }
