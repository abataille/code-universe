#if os(iOS)
import SwiftUI
import UIKit
import ZLImageEditor

struct ZLImageEditorWrapperView: UIViewControllerRepresentable {
    typealias UIViewControllerType = ZLEditImageViewController

    let image: UIImage
    let onComplete: (UIImage) -> Void
    let onCancel: () -> Void

    func makeUIViewController(context: Context) -> ZLEditImageViewController {
        ZLImageEditorUIConfiguration.default().adjustSliderType = .horizontal
        ZLImageEditorConfiguration.default().imageStickerContainerView = ZLSystemStickerPickerView()
        let controller = ZLEditImageViewController(image: image)
        controller.editFinishBlock = { editedImage, _ in
            onComplete(editedImage)
        }
        controller.cancelBlock = onCancel
        controller.modalPresentationStyle = .fullScreen
        return controller
    }

    func updateUIViewController(_ uiViewController: ZLEditImageViewController, context: Context) {}
}

private final class ZLSystemStickerPickerView: UIView, ZLImageStickerContainerDelegate, UIGestureRecognizerDelegate {
    var selectImageBlock: ((UIImage) -> Void)?
    var hideBlock: (() -> Void)?

    private let baseHeight: CGFloat = 260
    private let stickers: [String] = [
        "star.fill",
        "heart.fill",
        "bolt.fill",
        "flame.fill",
        "crown.fill",
        "sparkles",
        "sun.max.fill",
        "moon.stars.fill",
        "cloud.fill",
        "leaf.fill",
        "camera.fill",
        "music.note",
        "mic.fill",
        "film.fill",
        "globe",
        "paperplane.fill"
    ]

    private let panelView = UIVisualEffectView(effect: UIBlurEffect(style: .systemUltraThinMaterialDark))
    private let closeButton = UIButton(type: .system)
    private lazy var collectionView: UICollectionView = {
        let layout = UICollectionViewFlowLayout()
        layout.scrollDirection = .vertical
        layout.minimumLineSpacing = 12
        layout.minimumInteritemSpacing = 12
        layout.sectionInset = UIEdgeInsets(top: 16, left: 16, bottom: 16, right: 16)

        let view = UICollectionView(frame: .zero, collectionViewLayout: layout)
        view.backgroundColor = .clear
        view.delegate = self
        view.dataSource = self
        view.register(ZLSystemStickerCell.self, forCellWithReuseIdentifier: ZLSystemStickerCell.reuseIdentifier)
        return view
    }()

    override init(frame: CGRect) {
        super.init(frame: frame)
        setupUI()
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        panelView.frame = CGRect(x: 0, y: bounds.height - baseHeight, width: bounds.width, height: baseHeight)
        closeButton.frame = CGRect(x: panelView.bounds.width - 54, y: 10, width: 44, height: 44)
        collectionView.frame = CGRect(x: 0, y: 52, width: panelView.bounds.width, height: panelView.bounds.height - 52)
    }

    override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        let location = gestureRecognizer.location(in: self)
        return !panelView.frame.contains(location)
    }

    func show(in view: UIView) {
        if superview !== view {
            removeFromSuperview()
            frame = view.bounds
            autoresizingMask = [.flexibleWidth, .flexibleHeight]
            view.addSubview(self)
        }

        isHidden = false
        panelView.transform = CGAffineTransform(translationX: 0, y: baseHeight)
        backgroundColor = .clear

        UIView.animate(withDuration: 0.25) {
            self.backgroundColor = UIColor.black.withAlphaComponent(0.18)
            self.panelView.transform = .identity
        }
    }

    @objc private func dismissPicker() {
        hideBlock?()
        UIView.animate(withDuration: 0.25) {
            self.backgroundColor = .clear
            self.panelView.transform = CGAffineTransform(translationX: 0, y: self.baseHeight)
        } completion: { _ in
            self.isHidden = true
        }
    }

    private func setupUI() {
        backgroundColor = .clear

        let tap = UITapGestureRecognizer(target: self, action: #selector(dismissPicker))
        tap.delegate = self
        addGestureRecognizer(tap)

        panelView.clipsToBounds = true
        panelView.layer.cornerRadius = 24
        panelView.layer.maskedCorners = [.layerMinXMinYCorner, .layerMaxXMinYCorner]
        addSubview(panelView)

        let titleLabel = UILabel(frame: CGRect(x: 20, y: 16, width: 180, height: 22))
        titleLabel.text = "Stickers"
        titleLabel.font = .systemFont(ofSize: 17, weight: .semibold)
        titleLabel.textColor = .white
        panelView.contentView.addSubview(titleLabel)

        closeButton.setImage(UIImage(systemName: "xmark.circle.fill"), for: .normal)
        closeButton.tintColor = UIColor.white.withAlphaComponent(0.9)
        closeButton.addTarget(self, action: #selector(dismissPicker), for: .touchUpInside)
        panelView.contentView.addSubview(closeButton)

        panelView.contentView.addSubview(collectionView)
    }

    private func makeStickerImage(symbolName: String) -> UIImage? {
        let configuration = UIImage.SymbolConfiguration(pointSize: 48, weight: .regular)
        return UIImage(systemName: symbolName, withConfiguration: configuration)?
            .withTintColor(.white, renderingMode: .alwaysOriginal)
    }
}

extension ZLSystemStickerPickerView: UICollectionViewDataSource, UICollectionViewDelegateFlowLayout {
    func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int {
        stickers.count
    }

    func collectionView(_ collectionView: UICollectionView, cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
        let cell = collectionView.dequeueReusableCell(withReuseIdentifier: ZLSystemStickerCell.reuseIdentifier, for: indexPath) as! ZLSystemStickerCell
        cell.configure(symbolName: stickers[indexPath.item])
        return cell
    }

    func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) {
        guard let image = makeStickerImage(symbolName: stickers[indexPath.item]) else {
            return
        }
        selectImageBlock?(image)
        dismissPicker()
    }

    func collectionView(_ collectionView: UICollectionView, layout collectionViewLayout: UICollectionViewLayout, sizeForItemAt indexPath: IndexPath) -> CGSize {
        let columns: CGFloat = 4
        let spacing: CGFloat = 16 * 2 + 12 * (columns - 1)
        let width = floor((collectionView.bounds.width - spacing) / columns)
        return CGSize(width: width, height: width)
    }
}

private final class ZLSystemStickerCell: UICollectionViewCell {
    static let reuseIdentifier = "ZLSystemStickerCell"

    private let imageView = UIImageView()

    override init(frame: CGRect) {
        super.init(frame: frame)
        contentView.backgroundColor = UIColor.white.withAlphaComponent(0.08)
        contentView.layer.cornerRadius = 16

        imageView.contentMode = .scaleAspectFit
        imageView.tintColor = .white
        imageView.frame = contentView.bounds.insetBy(dx: 14, dy: 14)
        imageView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        contentView.addSubview(imageView)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func configure(symbolName: String) {
        let configuration = UIImage.SymbolConfiguration(pointSize: 34, weight: .regular)
        imageView.image = UIImage(systemName: symbolName, withConfiguration: configuration)
    }
}
#endif
