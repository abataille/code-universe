import AppKit

guard CommandLine.arguments.count == 2 else {
  fputs("usage: generate-mac-icon.swift OUTPUT.png\n", stderr)
  exit(2)
}

let image = NSImage(size: NSSize(width: 1024, height: 1024))
image.lockFocus()

let rect = NSRect(x: 48, y: 48, width: 928, height: 928)
NSColor(calibratedRed: 0.05, green: 0.07, blue: 0.09, alpha: 1).setFill()
NSBezierPath(roundedRect: rect, xRadius: 210, yRadius: 210).fill()
NSGradient(colors: [
  NSColor(calibratedRed: 0.10, green: 0.46, blue: 0.40, alpha: 1),
  NSColor(calibratedRed: 0.08, green: 0.12, blue: 0.16, alpha: 1)
])!.draw(in: NSBezierPath(roundedRect: rect.insetBy(dx: 42, dy: 42), xRadius: 180, yRadius: 180), angle: -35)

func cube(_ rect: NSRect, _ color: NSColor) {
  let path = NSBezierPath(roundedRect: rect, xRadius: 28, yRadius: 28)
  color.setFill()
  path.fill()
  NSColor.white.withAlphaComponent(0.2).setStroke()
  path.lineWidth = 6
  path.stroke()
}

func edge(_ start: NSPoint, _ end: NSPoint) {
  let path = NSBezierPath()
  path.move(to: start)
  path.line(to: end)
  NSColor(calibratedRed: 1.0, green: 0.31, blue: 0.37, alpha: 0.82).setStroke()
  path.lineWidth = 16
  path.lineCapStyle = .round
  path.stroke()
}

edge(NSPoint(x: 320, y: 650), NSPoint(x: 515, y: 505))
edge(NSPoint(x: 515, y: 505), NSPoint(x: 720, y: 640))
edge(NSPoint(x: 515, y: 505), NSPoint(x: 520, y: 300))
cube(NSRect(x: 220, y: 590, width: 200, height: 200), NSColor(calibratedRed: 0.50, green: 0.84, blue: 0.76, alpha: 1))
cube(NSRect(x: 425, y: 410, width: 190, height: 190), NSColor(calibratedRed: 0.72, green: 0.65, blue: 0.90, alpha: 1))
cube(NSRect(x: 630, y: 590, width: 180, height: 180), NSColor(calibratedRed: 0.91, green: 0.75, blue: 0.40, alpha: 1))

let attributes: [NSAttributedString.Key: Any] = [
  .font: NSFont.systemFont(ofSize: 190, weight: .black),
  .foregroundColor: NSColor.white.withAlphaComponent(0.94)
]
("</>" as NSString).draw(in: NSRect(x: 315, y: 130, width: 410, height: 220), withAttributes: attributes)

image.unlockFocus()
let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
try bitmap.representation(using: .png, properties: [:])!
  .write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
