using System;
using LocalMediaTransfer.GUI.Features.About;
using LocalMediaTransfer.GUI.Features.Activity;
using LocalMediaTransfer.GUI.Features.Dashboard;
using LocalMediaTransfer.GUI.Features.Network;
using LocalMediaTransfer.GUI.Features.Security;
using LocalMediaTransfer.GUI.Features.Settings;
using LocalMediaTransfer.GUI.Features.Send;

namespace LocalMediaTransfer.GUI.AppServices
{
    public static class NavigationService
    {
        public static Type? ResolvePage(string? tag)
        {
            return tag switch
            {
                "Receive" => typeof(DashboardPage),
                "Dashboard" => typeof(DashboardPage),
                "Send" => typeof(SendPage),
                "Activity" => typeof(ActivityPage),
                "Network" => typeof(NetworkPage),
                "Security" => typeof(SecurityPage),
                "About" => typeof(AboutPage),
                "Settings" => typeof(SettingsPage),
                _ => null
            };
        }
    }
}
