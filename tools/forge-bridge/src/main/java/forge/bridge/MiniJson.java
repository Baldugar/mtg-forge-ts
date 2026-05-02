// SPDX-License-Identifier: GPL-3.0-or-later
//
// MiniJson — zero-dependency JSON parser + writer.
//
// Why hand-rolled? Forge's fat jar has no Jackson/Gson and pulling one in
// would balloon the bridge classpath. The GoldenScenario format is small
// (objects, arrays, strings, numbers, booleans, null) — a 200-line parser
// is enough.
//
// Limitations:
//   - No streaming. Loads the whole document into memory; fine for our
//     scenario sizes (kilobytes, never megabytes).
//   - Numbers are returned as Long (integers) or Double (with decimal/exp).
//   - No Unicode-escape decoding beyond standard \\uXXXX. We don't emit those.
//   - Writer pretty-prints with two-space indent; the runner consumes the
//     output as plain JSON either way.

package forge.bridge;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

final class MiniJson {

    // ---------- Parser ----------

    static Object parse(String s) {
        Parser p = new Parser(s);
        p.skipWs();
        Object v = p.parseValue();
        p.skipWs();
        if (!p.eof()) throw new RuntimeException("Trailing JSON at offset " + p.pos);
        return v;
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> asObject(Object v) {
        if (v == null) return new LinkedHashMap<>();
        if (!(v instanceof Map)) {
            throw new RuntimeException("Expected JSON object, got " + v.getClass().getSimpleName());
        }
        return (Map<String, Object>) v;
    }

    @SuppressWarnings("unchecked")
    static List<Object> asArray(Object v) {
        if (v == null) return new ArrayList<>();
        if (!(v instanceof List)) {
            throw new RuntimeException("Expected JSON array, got " + v.getClass().getSimpleName());
        }
        return (List<Object>) v;
    }

    static List<Object> asArrayOrEmpty(Object v) {
        if (v == null) return new ArrayList<>();
        return asArray(v);
    }

    static Map<String, Object> asObjectOrEmpty(Object v) {
        if (v == null) return new LinkedHashMap<>();
        return asObject(v);
    }

    private static final class Parser {
        final String s; int pos = 0;
        Parser(String s) { this.s = s; }

        boolean eof() { return pos >= s.length(); }

        void skipWs() {
            while (pos < s.length() && Character.isWhitespace(s.charAt(pos))) pos++;
        }

        Object parseValue() {
            skipWs();
            if (eof()) throw new RuntimeException("Unexpected EOF");
            char c = s.charAt(pos);
            switch (c) {
                case '{': return parseObject();
                case '[': return parseArray();
                case '"': return parseString();
                case 't': case 'f': return parseBool();
                case 'n': return parseNull();
                default:
                    if (c == '-' || (c >= '0' && c <= '9')) return parseNumber();
                    throw new RuntimeException("Unexpected char '" + c + "' at " + pos);
            }
        }

        Map<String, Object> parseObject() {
            expect('{');
            Map<String, Object> obj = new LinkedHashMap<>();
            skipWs();
            if (peek() == '}') { pos++; return obj; }
            while (true) {
                skipWs();
                String key = parseString();
                skipWs();
                expect(':');
                Object val = parseValue();
                obj.put(key, val);
                skipWs();
                char c = next();
                if (c == ',') continue;
                if (c == '}') return obj;
                throw new RuntimeException("Expected ',' or '}' at " + (pos - 1));
            }
        }

        List<Object> parseArray() {
            expect('[');
            List<Object> out = new ArrayList<>();
            skipWs();
            if (peek() == ']') { pos++; return out; }
            while (true) {
                out.add(parseValue());
                skipWs();
                char c = next();
                if (c == ',') continue;
                if (c == ']') return out;
                throw new RuntimeException("Expected ',' or ']' at " + (pos - 1));
            }
        }

        String parseString() {
            expect('"');
            StringBuilder sb = new StringBuilder();
            while (true) {
                if (eof()) throw new RuntimeException("Unterminated string");
                char c = s.charAt(pos++);
                if (c == '"') return sb.toString();
                if (c == '\\') {
                    if (eof()) throw new RuntimeException("Unterminated escape");
                    char e = s.charAt(pos++);
                    switch (e) {
                        case '"': sb.append('"'); break;
                        case '\\': sb.append('\\'); break;
                        case '/': sb.append('/'); break;
                        case 'b': sb.append('\b'); break;
                        case 'f': sb.append('\f'); break;
                        case 'n': sb.append('\n'); break;
                        case 'r': sb.append('\r'); break;
                        case 't': sb.append('\t'); break;
                        case 'u':
                            if (pos + 4 > s.length()) throw new RuntimeException("Bad \\u escape");
                            sb.append((char) Integer.parseInt(s.substring(pos, pos + 4), 16));
                            pos += 4;
                            break;
                        default:
                            throw new RuntimeException("Unknown escape \\" + e);
                    }
                } else {
                    sb.append(c);
                }
            }
        }

        Boolean parseBool() {
            if (s.startsWith("true", pos)) { pos += 4; return Boolean.TRUE; }
            if (s.startsWith("false", pos)) { pos += 5; return Boolean.FALSE; }
            throw new RuntimeException("Expected bool at " + pos);
        }

        Object parseNull() {
            if (s.startsWith("null", pos)) { pos += 4; return null; }
            throw new RuntimeException("Expected null at " + pos);
        }

        Number parseNumber() {
            int start = pos;
            if (peek() == '-') pos++;
            while (pos < s.length() && Character.isDigit(s.charAt(pos))) pos++;
            boolean isFloat = false;
            if (pos < s.length() && s.charAt(pos) == '.') {
                isFloat = true; pos++;
                while (pos < s.length() && Character.isDigit(s.charAt(pos))) pos++;
            }
            if (pos < s.length() && (s.charAt(pos) == 'e' || s.charAt(pos) == 'E')) {
                isFloat = true; pos++;
                if (pos < s.length() && (s.charAt(pos) == '+' || s.charAt(pos) == '-')) pos++;
                while (pos < s.length() && Character.isDigit(s.charAt(pos))) pos++;
            }
            String num = s.substring(start, pos);
            return isFloat ? (Number) Double.valueOf(num) : (Number) Long.valueOf(num);
        }

        char peek() { return eof() ? '\0' : s.charAt(pos); }
        char next() { if (eof()) throw new RuntimeException("EOF"); return s.charAt(pos++); }
        void expect(char c) {
            if (eof() || s.charAt(pos) != c) {
                throw new RuntimeException("Expected '" + c + "' at " + pos);
            }
            pos++;
        }
    }

    // ---------- Writer ----------

    static String write(Object v) {
        StringBuilder sb = new StringBuilder();
        writeValue(sb, v, 0);
        return sb.toString();
    }

    private static void writeValue(StringBuilder sb, Object v, int depth) {
        if (v == null) { sb.append("null"); return; }
        if (v instanceof String) { writeString(sb, (String) v); return; }
        if (v instanceof Boolean) { sb.append(((Boolean) v) ? "true" : "false"); return; }
        if (v instanceof Number) {
            // JSON numbers — strip trailing .0 from doubles when integral.
            if (v instanceof Double) {
                double d = (Double) v;
                if (!Double.isFinite(d)) { sb.append("null"); return; }
                if (d == Math.floor(d) && !Double.isInfinite(d)) {
                    sb.append(String.valueOf((long) d));
                } else {
                    sb.append(v.toString());
                }
            } else {
                sb.append(v.toString());
            }
            return;
        }
        if (v instanceof Map) { writeObject(sb, (Map<?, ?>) v, depth); return; }
        if (v instanceof List) { writeArray(sb, (List<?>) v, depth); return; }
        // Fallback: stringify.
        writeString(sb, String.valueOf(v));
    }

    private static void writeObject(StringBuilder sb, Map<?, ?> m, int depth) {
        if (m.isEmpty()) { sb.append("{}"); return; }
        sb.append('{');
        int i = 0;
        for (Map.Entry<?, ?> e : m.entrySet()) {
            if (i++ > 0) sb.append(',');
            sb.append('\n');
            indent(sb, depth + 1);
            writeString(sb, String.valueOf(e.getKey()));
            sb.append(": ");
            writeValue(sb, e.getValue(), depth + 1);
        }
        sb.append('\n');
        indent(sb, depth);
        sb.append('}');
    }

    private static void writeArray(StringBuilder sb, List<?> a, int depth) {
        if (a.isEmpty()) { sb.append("[]"); return; }
        sb.append('[');
        for (int i = 0; i < a.size(); i++) {
            if (i > 0) sb.append(',');
            sb.append('\n');
            indent(sb, depth + 1);
            writeValue(sb, a.get(i), depth + 1);
        }
        sb.append('\n');
        indent(sb, depth);
        sb.append(']');
    }

    private static void writeString(StringBuilder sb, String s) {
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                case '\b': sb.append("\\b"); break;
                case '\f': sb.append("\\f"); break;
                default:
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        sb.append('"');
    }

    private static void indent(StringBuilder sb, int depth) {
        for (int i = 0; i < depth; i++) sb.append("  ");
    }

    private MiniJson() {}
}
