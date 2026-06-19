package com.aylink.mobile.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import com.aylink.mobile.data.repo.LocalSettingsStore
import com.aylink.mobile.data.repo.PointerSamplingRateHz
import com.aylink.mobile.data.repo.ThemeMode
import com.aylink.mobile.logging.AppLogger
import com.aylink.mobile.logging.DiagnosticLogExporter

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    settingsStore: LocalSettingsStore,
    logger: AppLogger,
    logExporter: DiagnosticLogExporter
) {
    val settings by settingsStore.settings.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()
    var logActionMessage by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        SettingCard(
            title = "主题",
            description = "选择应用的外观模式"
        ) {
            ThemeMode.entries.forEach { mode ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = when (mode) {
                                ThemeMode.SYSTEM -> "跟随系统"
                                ThemeMode.LIGHT -> "浅色模式"
                                ThemeMode.DARK -> "深色模式"
                            },
                            style = MaterialTheme.typography.bodyLarge
                        )
                    }
                    RadioButton(
                        selected = settings.themeMode == mode,
                        onClick = { settingsStore.updateThemeMode(mode) }
                    )
                }
            }
        }

        SettingCard(
            title = "动态取色",
            description = "Android 12 及以上可使用系统动态颜色"
        ) {
            SettingSwitchRow(
                title = "启用动态颜色",
                checked = settings.useDynamicColor,
                onCheckedChange = settingsStore::updateDynamicColor
            )
        }

        SettingCard(
            title = "远程恢复",
            description = "应用返回前台后，尝试恢复上次投屏连接"
        ) {
            SettingSwitchRow(
                title = "恢复上次投屏",
                checked = settings.resumeLastRemote,
                onCheckedChange = settingsStore::updateResumeLastRemote
            )
        }

        SettingCard(
            title = "操作采样",
            description = "调整远程触控移动的发送频率与弱网策略"
        ) {
            SettingSwitchRow(
                title = "自适应采样",
                checked = settings.adaptivePointerSampling,
                onCheckedChange = settingsStore::updateAdaptivePointerSampling
            )
            Spacer(modifier = Modifier.height(12.dp))
            Text(
                text = "自定义采样",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(modifier = Modifier.height(8.dp))
            PointerSamplingRateHz.entries.forEach { rate ->
                SettingRadioRow(
                    title = "${rate.hz}Hz",
                    selected = settings.pointerSamplingRateHz == rate,
                    enabled = !settings.adaptivePointerSampling,
                    onClick = { settingsStore.updatePointerSamplingRate(rate) }
                )
            }
            Spacer(modifier = Modifier.height(12.dp))
            SettingSwitchRow(
                title = "弱网模式",
                checked = settings.weakNetworkMode,
                enabled = !settings.adaptivePointerSampling,
                onCheckedChange = settingsStore::updateWeakNetworkMode
            )
        }

        SettingCard(
            title = "诊断日志",
            description = "导出最近的应用日志，便于排查远程连接问题"
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Button(
                    modifier = Modifier.weight(1f),
                    onClick = {
                        coroutineScope.launch {
                            runCatching {
                                logger.i("AYLinkSettings", "Diagnostic log export requested")
                                val shareIntent = withContext(Dispatchers.IO) {
                                    logExporter.createExportIntent()
                                }
                                context.startActivity(
                                    android.content.Intent.createChooser(
                                        shareIntent,
                                        "导出诊断日志"
                                    )
                                )
                            }.onSuccess {
                                logActionMessage = "已打开分享面板"
                            }.onFailure { error ->
                                logger.w("AYLinkSettings", "Diagnostic log export failed: ${error.message}", error)
                                logActionMessage = error.message ?: "导出失败"
                            }
                        }
                    }
                ) {
                    Text("导出日志")
                }
                OutlinedButton(
                    modifier = Modifier.weight(1f),
                    onClick = {
                        logger.clear()
                        logActionMessage = "日志已清空"
                    }
                ) {
                    Text("清空日志")
                }
            }
            logActionMessage?.let { message ->
                Spacer(modifier = Modifier.height(12.dp))
                Text(
                    text = message,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
private fun SettingCard(
    title: String,
    description: String,
    content: @Composable () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)
        )
    ) {
        Column(
            modifier = Modifier.padding(16.dp)
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
                color = MaterialTheme.colorScheme.onSurface
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = description,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(modifier = Modifier.height(16.dp))
            content()
        }
    }
}

@Composable
private fun SettingSwitchRow(
    title: String,
    checked: Boolean,
    enabled: Boolean = true,
    onCheckedChange: (Boolean) -> Unit
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surface.copy(alpha = if (enabled) 0.6f else 0.35f)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyLarge,
                color = if (enabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f)
            )
            Switch(
                checked = checked,
                enabled = enabled,
                onCheckedChange = onCheckedChange
            )
        }
    }
}

@Composable
private fun SettingRadioRow(
    title: String,
    selected: Boolean,
    enabled: Boolean,
    onClick: () -> Unit
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surface.copy(alpha = if (enabled) 0.6f else 0.35f)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyLarge,
                color = if (enabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f)
            )
            RadioButton(
                selected = selected,
                enabled = enabled,
                onClick = onClick
            )
        }
    }
}
