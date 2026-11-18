import Foundation
import CoreGraphics
let pid = Int(CommandLine.arguments[1])!
let duration = Double(CommandLine.arguments[2])!
let output = CommandLine.arguments[3]
func visible() -> Bool {
    autoreleasepool {
        let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
        return list.contains { item in
            guard (item[kCGWindowOwnerPID as String] as? Int) == pid,
                  let bounds = item[kCGWindowBounds as String] as? [String: Double],
                  let width = bounds["Width"], let height = bounds["Height"] else { return false }
            return width > 250 && width < 710 && height > 250 && height < 1000
        }
    }
}
let start = ProcessInfo.processInfo.systemUptime
var last = visible()
var events = [[String: Any]]()
print("window timing probe ready; initially visible=\(last)")
fflush(stdout)
while ProcessInfo.processInfo.systemUptime - start < duration {
    let current = visible()
    if current != last {
        let since = CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: .keyDown)
        events.append(["elapsed_seconds": ProcessInfo.processInfo.systemUptime - start,
                       "visible": current, "last_keydown_to_visibility_ms": since * 1000,
                       "recent_keydown": since >= 0 && since < 1])
        last = current
    }
    Thread.sleep(forTimeInterval: 0.005)
}
let result: [String: Any] = ["pid": pid, "poll_interval_ms": 5,
 "definition": "last system keydown to WindowServer on-screen visibility; not first painted frame", "events": events]
let data = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
try data.write(to: URL(fileURLWithPath: output))
print("recorded \(events.count) visibility transitions")
