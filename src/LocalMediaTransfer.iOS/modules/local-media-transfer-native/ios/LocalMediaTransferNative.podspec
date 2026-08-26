Pod::Spec.new do |s|
  s.name           = 'LocalMediaTransferNative'
  s.version        = '2.0.0'
  s.summary        = 'Native discovery and raw file transport for Local Media Transfer'
  s.description    = s.summary
  s.author         = 'Local Media Transfer'
  s.homepage       = 'https://github.com/RonPiece/LocalMediaTransfer'
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,mm,swift}'
end
