import pngIcon from '../../../resources/icon.png?asset';
import windowsIcon from '../../../resources/icon.ico?asset';

// Windows can pick the right embedded size for each DPI instead of resizing a
// large PNG. The PNG remains available for HTML and native notification images.
export { pngIcon };
export default process.platform === 'win32' ? windowsIcon : pngIcon;
