package expo.modules.localmediatransfer

import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.SocketTimeoutException
import org.json.JSONObject

internal object AndroidDiscoveryService {
  fun discover(timeout: Int, port: Int, environment: String): List<Map<String, Any>> {
    require(port in 1..65535 && environment in listOf("production", "test"))
    val wifi = NetworkInterface.getNetworkInterfaces().toList().firstOrNull {
      it.isUp && it.name.startsWith("wlan") && it.inetAddresses.toList().any { address -> address is Inet4Address }
    } ?: return emptyList()
    val local = wifi.inetAddresses.toList().filterIsInstance<Inet4Address>().firstOrNull() ?: return emptyList()
    val octets = local.address.map { it.toInt() and 255 }
    val prefix = byteArrayOf(octets[0].toByte(), octets[1].toByte(), octets[2].toByte())
    val query = "{\"type\":\"lmt-discovery-query\",\"version\":2}".toByteArray(Charsets.UTF_8)
    val found = linkedMapOf<String, Map<String, Any>>()
    DatagramSocket().use { socket ->
      socket.broadcast = false
      socket.soTimeout = minOf(5000, maxOf(250, timeout))
      for (last in 1..254) {
        if (last == octets[3]) continue
        val address = InetAddress.getByAddress(prefix + last.toByte())
        socket.send(DatagramPacket(query, query.size, address, port))
      }
      val deadline = System.currentTimeMillis() + minOf(5000, maxOf(250, timeout))
      while (System.currentTimeMillis() < deadline) {
        try {
          val bytes = ByteArray(2048)
          val reply = DatagramPacket(bytes, bytes.size)
          socket.soTimeout = maxOf(1, (deadline - System.currentTimeMillis()).toInt())
          socket.receive(reply)
          val objectValue = JSONObject(String(reply.data, 0, reply.length, Charsets.UTF_8))
          if (objectValue.optString("type") != "lmt-discovery-response" ||
              objectValue.optInt("version") != 2 || objectValue.optString("environment") != environment) continue
          val id = objectValue.optString("serverId")
          if (id.isBlank()) continue
          found[id] = mapOf("serverId" to id, "name" to objectValue.optString("name", "Desktop"),
            "address" to reply.address.hostAddress.orEmpty(),
            "httpsPort" to objectValue.optInt("httpsPort"), "httpPort" to objectValue.optInt("httpPort"),
            "certificateFingerprint" to objectValue.optString("certificateFingerprint"),
            "approvalRequired" to objectValue.optBoolean("approvalRequired", true),
            "environment" to environment)
        } catch (_: SocketTimeoutException) { break }
        catch (_: Exception) { continue }
      }
    }
    return found.values.toList()
  }

}
