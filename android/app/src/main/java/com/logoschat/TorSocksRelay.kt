package com.logoschat

import java.io.InputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import kotlin.concurrent.thread

/**
 * #319: a tiny local TCP → Tor SOCKS5 relay for the DELIVERY path.
 *
 * The delivery node (nwaku) has no SOCKS/proxy option, but in Edge mode it dials exactly
 * ONE static service node over TCP. So we point it at a loopback listener here and relay
 * every byte through the embedded Tor's SOCKS5 proxy to the real node — which then sees a
 * Tor exit IP, not the user's real IP. libp2p is noise-encrypted end-to-end and
 * authenticates by peerId (not IP), so a dumb byte pump is safe. Proven feasible: Tor
 * exits reach msg.logos.live:30304.
 *
 * Usage: start() returns the loopback port; set the delivery service node to
 * /ip4/127.0.0.1/tcp/<port>/p2p/<same peerId> so the node dials the relay.
 */
class TorSocksRelay(
    private val socksPort: Int,
    private val targetHost: String,
    private val targetPort: Int,
    private val localPort: Int,
) {
  @Volatile private var server: ServerSocket? = null
  @Volatile private var running = false

  /** Bind the fixed loopback port and start accepting; returns the bound port. */
  fun start(): Int {
    val ss = ServerSocket()
    ss.bind(InetSocketAddress("127.0.0.1", localPort))
    server = ss
    running = true
    thread(name = "tor-relay-accept", isDaemon = true) {
      while (running) {
        val client =
            try {
              ss.accept()
            } catch (_: Throwable) {
              break
            }
        thread(name = "tor-relay-conn", isDaemon = true) { handle(client) }
      }
    }
    return ss.localPort
  }

  fun stop() {
    running = false
    try {
      server?.close()
    } catch (_: Throwable) {}
    server = null
  }

  private fun handle(client: Socket) {
    var upstream: Socket? = null
    try {
      upstream = socks5Connect(targetHost, targetPort)
      val u = upstream
      val a = pump(client, u, "c2u")
      val b = pump(u, client, "u2c")
      a.join()
      b.join()
    } catch (_: Throwable) {
      // drop the connection; the node will retry
    } finally {
      try {
        client.close()
      } catch (_: Throwable) {}
      try {
        upstream?.close()
      } catch (_: Throwable) {}
    }
  }

  /** SOCKS5 CONNECT tunnel through Tor to host:port (domain ATYP → exit resolves DNS). */
  private fun socks5Connect(host: String, port: Int): Socket {
    val s = Socket()
    s.connect(InetSocketAddress("127.0.0.1", socksPort), 15000)
    val out = s.getOutputStream()
    val inp = s.getInputStream()
    out.write(byteArrayOf(0x05, 0x01, 0x00)) // VER, 1 method, NO_AUTH
    out.flush()
    val greet = ByteArray(2)
    readFully(inp, greet)
    if (greet[0].toInt() != 0x05 || greet[1].toInt() != 0x00) {
      throw RuntimeException("socks greeting failed")
    }
    val hb = host.toByteArray(Charsets.US_ASCII)
    val req = ByteArray(4 + 1 + hb.size + 2)
    req[0] = 0x05 // VER
    req[1] = 0x01 // CONNECT
    req[2] = 0x00 // RSV
    req[3] = 0x03 // ATYP = domain
    req[4] = hb.size.toByte()
    System.arraycopy(hb, 0, req, 5, hb.size)
    req[5 + hb.size] = (port ushr 8).toByte()
    req[6 + hb.size] = port.toByte()
    out.write(req)
    out.flush()
    val head = ByteArray(4)
    readFully(inp, head)
    if (head[1].toInt() != 0x00) throw RuntimeException("socks connect code=${head[1].toInt()}")
    // Consume the bound address + port that follows, per ATYP.
    val addrLen =
        when (head[3].toInt()) {
          0x01 -> 4
          0x04 -> 16
          0x03 -> {
            val l = ByteArray(1)
            readFully(inp, l)
            l[0].toInt() and 0xff
          }
          else -> 0
        }
    readFully(inp, ByteArray(addrLen + 2))
    return s
  }

  private fun pump(from: Socket, to: Socket, tag: String): Thread =
      thread(name = "tor-relay-$tag", isDaemon = true) {
        try {
          val buf = ByteArray(16 * 1024)
          val i = from.getInputStream()
          val o = to.getOutputStream()
          while (true) {
            val n = i.read(buf)
            if (n < 0) break
            o.write(buf, 0, n)
            o.flush()
          }
        } catch (_: Throwable) {
          // connection closed
        } finally {
          try {
            to.shutdownOutput()
          } catch (_: Throwable) {}
        }
      }

  private fun readFully(inp: InputStream, b: ByteArray) {
    var off = 0
    while (off < b.size) {
      val n = inp.read(b, off, b.size - off)
      if (n < 0) throw RuntimeException("unexpected eof")
      off += n
    }
  }
}
