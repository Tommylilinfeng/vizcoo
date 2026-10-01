using MyApp.Util;

namespace MyApp.Lib;

public static class Logger
{
    public static void Log(string msg)
    {
        var h = new Helper(msg);
        System.Console.WriteLine(h.Shout());
    }
}
