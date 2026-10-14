package expo.modules.localmediatransfer

import java.net.HttpURLConnection
import java.util.concurrent.ConcurrentHashMap

/** Owns picker references and live connections for each foreground transfer. */
internal class AndroidTransferSessions {
  private val selected = ConcurrentHashMap<String, MutableSet<String>>()
  private val cancelled = ConcurrentHashMap.newKeySet<String>()
  private val active = ConcurrentHashMap<HttpURLConnection, String>()

  fun begin(session: String) {
    require(session.isNotBlank() && selected.putIfAbsent(session, ConcurrentHashMap.newKeySet()) == null)
    cancelled.remove(session)
  }

  fun exists(session: String) = selected.containsKey(session)
  fun own(session: String, uri: String) {
    check(!isCancelled(session))
    check(selected[session]?.add(uri) == true)
  }
  fun owns(session: String, uri: String) = selected[session]?.contains(uri) == true
  fun release(session: String, uri: String) = selected[session]?.remove(uri) == true
  fun isCancelled(session: String) = cancelled.contains(session)

  fun register(session: String, connection: HttpURLConnection) {
    synchronized(active) {
      check(exists(session) && !isCancelled(session))
      active[connection] = session
    }
  }

  fun unregister(connection: HttpURLConnection) { active.remove(connection) }

  fun cancel(session: String) {
    synchronized(active) {
      cancelled.add(session)
      active.filterValues { it == session }.keys.forEach { it.disconnect() }
    }
  }

  fun end(session: String) {
    cancel(session)
    selected.remove(session)
    cancelled.remove(session)
  }

  fun disconnectAll() { active.keys.forEach { it.disconnect() } }
  fun clear() {
    disconnectAll()
    active.clear()
    selected.clear()
    cancelled.clear()
  }
}
