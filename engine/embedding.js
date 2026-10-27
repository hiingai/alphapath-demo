/* AlphaPath · 零依赖特征哈希嵌入（1:1 移植 v1.4 agent/embedding.py）
 * 为保证与 Python 版检索排序完全一致，这里实现了 MD5（utf-8 bytes）定址：
 *   int(md5(token).hexdigest(), 16) % dim
 * 中文按「单字 + 2-gram」切分；余弦相似度用稀疏 dict。
 */
(function (global) {
  'use strict';
  var AP = (global.AP = (global.AP || {}));

  var SHIFT = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ];
  var KTAB = (function () {
    var t = new Array(64);
    for (var i = 0; i < 64; i++) t[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
    return t;
  })();

  var enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  function utf8Bytes(s) {
    if (enc) return enc.encode(s);
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0xd800 || c >= 0xe000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else {
        i++;
        var c2 = s.charCodeAt(i);
        var cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      }
    }
    return out;
  }

  function md5(data) {
    var len = data.length;
    var padLen = (len + 9 + 63) & ~63;
    var m = new Uint8Array(padLen);
    m.set(data);
    m[len] = 0x80;
    var bits = len * 8;
    var lo = bits >>> 0;
    var hi = Math.floor(bits / 4294967296) >>> 0;
    m[padLen - 8] = lo & 0xff; m[padLen - 7] = (lo >>> 8) & 0xff;
    m[padLen - 6] = (lo >>> 16) & 0xff; m[padLen - 5] = (lo >>> 24) & 0xff;
    m[padLen - 4] = hi & 0xff; m[padLen - 3] = (hi >>> 8) & 0xff;
    m[padLen - 2] = (hi >>> 16) & 0xff; m[padLen - 1] = (hi >>> 24) & 0xff;

    var a0 = 0x67452301 | 0, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476 | 0;
    var M = new Int32Array(16);
    for (var off = 0; off < padLen; off += 64) {
      for (var i = 0; i < 16; i++) {
        var p = off + i * 4;
        M[i] = m[p] | (m[p + 1] << 8) | (m[p + 2] << 16) | (m[p + 3] << 24);
      }
      var A = a0, B = b0, C = c0, D = d0;
      for (var j = 0; j < 64; j++) {
        var F, g;
        if (j < 16) { F = (B & C) | (~B & D); g = j; }
        else if (j < 32) { F = (D & B) | (~D & C); g = (5 * j + 1) % 16; }
        else if (j < 48) { F = B ^ C ^ D; g = (3 * j + 5) % 16; }
        else { F = C ^ (B | ~D); g = (7 * j) % 16; }
        var tmp = D; D = C; C = B;
        var sum = (A + F + KTAB[j] + M[g]) | 0;
        var sh = SHIFT[j];
        B = (B + ((sum << sh) | (sum >>> (32 - sh)))) | 0;
        A = tmp;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }
    var out = new Uint8Array(16);
    [a0, b0, c0, d0].forEach(function (w, k) {
      out[k * 4] = w & 0xff;
      out[k * 4 + 1] = (w >>> 8) & 0xff;
      out[k * 4 + 2] = (w >>> 16) & 0xff;
      out[k * 4 + 3] = (w >>> 24) & 0xff;
    });
    return out;
  }

  function ngrams(text, n) {
    n = n || 2;
    text = String(text == null ? '' : text).toLowerCase().trim();
    var chars = Array.from(text);
    var grams = chars.slice();
    for (var i = 0; i + n <= chars.length; i++) grams.push(chars.slice(i, i + n).join(''));
    return grams;
  }

  function hashIndex(token, dim) {
    var digest = md5(utf8Bytes(String(token)));
    var rem = 0;
    for (var i = 0; i < digest.length; i++) rem = (rem * 256 + digest[i]) % dim;
    return rem;
  }

  function Embedder(dim) { this.dim = parseInt(dim || 256, 10); }
  Embedder.prototype.embed = function (text) {
    var counts = {};
    var grams = ngrams(text);
    for (var i = 0; i < grams.length; i++) {
      var idx = hashIndex(grams[i], this.dim);
      counts[idx] = (counts[idx] || 0) + 1;
    }
    var norm = 0, k;
    for (k in counts) norm += counts[k] * counts[k];
    norm = Math.sqrt(norm);
    if (norm > 0) for (k in counts) counts[k] = counts[k] / norm;
    return counts;
  };
  Embedder.cosine = function (a, b) {
    if (!a || !b) return 0;
    var dot = 0, na = 0, nb = 0, k;
    for (k in a) { na += a[k] * a[k]; if (b[k] !== undefined) dot += a[k] * b[k]; }
    for (k in b) nb += b[k] * b[k];
    na = Math.sqrt(na); nb = Math.sqrt(nb);
    return na && nb ? dot / (na * nb) : 0;
  };
  Embedder.prototype.cosine = function (a, b) { return Embedder.cosine(a, b); };
  Embedder.prototype.similarity = function (a, b) { return Embedder.cosine(this.embed(a), this.embed(b)); };

  AP.Embedder = Embedder;
  AP.ngrams = ngrams;
  AP._md5hex = function (s) {
    return Array.prototype.map.call(md5(utf8Bytes(String(s))), function (b) {
      return ('0' + b.toString(16)).slice(-2);
    }).join('');
  };
})(typeof window !== 'undefined' ? window : globalThis);
