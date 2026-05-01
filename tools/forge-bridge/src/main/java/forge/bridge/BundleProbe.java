// SPDX-License-Identifier: GPL-3.0-or-later
package forge.bridge;

import java.io.File;
import java.net.URL;
import java.net.URLClassLoader;
import java.util.Locale;
import java.util.ResourceBundle;

/** One-off diagnostic tool: probe how Forge's Localizer is failing. */
public final class BundleProbe {
    public static void main(String[] args) throws Exception {
        String dir = args.length > 0 ? args[0] : "../forge-gui/res/languages/";
        File f = new File(dir);
        System.out.println("cwd:        " + new File(".").getAbsolutePath());
        System.out.println("dir absolu: " + f.getAbsolutePath());
        System.out.println("dir exists: " + f.exists());
        System.out.println("dir is dir: " + f.isDirectory());
        URL u = f.toURI().toURL();
        System.out.println("url:        " + u);
        ClassLoader cl = new URLClassLoader(new URL[] { u });
        URL probeFile = cl.getResource("en-US.properties");
        System.out.println("loader sees en-US.properties: " + probeFile);
        try {
            ResourceBundle b = ResourceBundle.getBundle("en-US", new Locale("en", "US"), cl);
            System.out.println("bundle (en,US) loaded! base=" + b.getBaseBundleName());
        } catch (Throwable t) {
            System.out.println("bundle (en,US) FAILED:");
            t.printStackTrace();
        }
        try {
            ResourceBundle b = ResourceBundle.getBundle("en-US", new Locale("en_US"), cl);
            System.out.println("bundle (en_US single) loaded! base=" + b.getBaseBundleName());
        } catch (Throwable t) {
            System.out.println("bundle (en_US single) FAILED:");
            t.printStackTrace();
        }
    }
}
