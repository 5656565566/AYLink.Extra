package com.aylink.mobile.data.transport

import com.aylink.mobile.data.api.ApiException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import okhttp3.Request
import okhttp3.Response

internal interface DeviceConnection {
    val isOpen: Boolean

    suspend fun request(request: Request): Response

    fun close()
}

internal class DeviceConnectionPool(
    private val scope: CoroutineScope,
    private val accountKey: () -> String,
    private val connect: suspend (Int) -> DeviceConnection,
    private val now: () -> Long = { System.nanoTime() / 1_000_000 },
) {
    private class Entry {
        var connection: DeviceConnection? = null
        var pending: Deferred<DeviceConnection?>? = null
        var unavailableUntil = 0L
    }

    private val lock = Any()
    private var account = ""
    private val entries = mutableMapOf<Int, Entry>()

    suspend fun acquire(deviceId: Int): DeviceConnection? {
        val pending =
            synchronized(lock) {
                refreshAccount()
                val currentAccount = accountKey()
                val entry = entries.getOrPut(deviceId) { Entry() }
                entry.connection?.takeIf { it.isOpen }?.let { return it }
                entry.pending?.let { return@synchronized it }
                if (entry.unavailableUntil > now()) return null
                entry.connection?.close()
                scope
                    .async {
                        try {
                            val connection = connect(deviceId)
                            synchronized(lock) {
                                if (entries[deviceId] !== entry || accountKey() != currentAccount) {
                                    connection.close()
                                    throw CancellationException("RTC account session changed")
                                }
                                entry.connection = connection
                            }
                            connection
                        } catch (error: CancellationException) {
                            throw error
                        } catch (error: Exception) {
                            if (error is ApiException && error.statusCode == 401) throw error
                            synchronized(lock) { entry.unavailableUntil = now() + 30_000 }
                            null
                        } finally {
                            synchronized(lock) { entry.pending = null }
                        }
                    }.also { entry.pending = it }
            }
        // 等待者取消不能取消其他文件或终端共享的建连任务。
        return pending.await()
    }

    fun close() {
        synchronized(lock) {
            entries.values.forEach {
                it.pending?.cancel()
                it.connection?.close()
            }
            entries.clear()
        }
    }

    fun refreshAccount() {
        synchronized(lock) {
            val current = accountKey()
            if (account != current) {
                close()
                account = current
            }
        }
    }
}
