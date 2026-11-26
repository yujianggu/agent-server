"""Browser acceptance tests for the local workspace prototype."""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import re
import unittest

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
WAIT = 2_000


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


class WorkspaceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        handler = partial(QuietHandler, directory=str(ROOT))
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.addClassCleanup(server.server_close)
        worker = Thread(target=server.serve_forever, daemon=True)
        worker.start()
        cls.addClassCleanup(worker.join)
        cls.addClassCleanup(server.shutdown)

        playwright = sync_playwright().start()
        cls.addClassCleanup(playwright.stop)
        cls.browser = playwright.chromium.launch()
        cls.addClassCleanup(cls.browser.close)
        cls.url = f"http://127.0.0.1:{server.server_port}/"

    def open_workspace(self, width=1440, height=900):
        context = self.browser.new_context(viewport={"width": width, "height": height})
        self.addCleanup(context.close)
        page = context.new_page()
        page.set_default_timeout(WAIT)
        page.goto(self.url)
        return page

    def open_conversation(self, page, name="安装 shotproof"):
        recent = page.get_by_role("region", name="最近", exact=True)
        recent.get_by_role("button", name=name, exact=True).click()
        expect(page.get_by_role("banner").get_by_role("heading", name=name, exact=True)).to_be_visible()

    def test_web_work_landing_and_chat_mode(self):
        page = self.open_workspace(width=1470, height=923)
        toolbar = page.get_by_role("banner")
        chat = page.get_by_role("main")
        work = chat.get_by_role("button", name="工作", exact=True)
        work_tip = chat.get_by_role("heading", name="看看工作模式能做什么", exact=True)
        expect(page.get_by_role("button", name="ChatGPT", exact=True)).to_be_visible(timeout=750)
        expect(toolbar.get_by_role("heading", name="开始聊天", exact=True)).to_be_visible()
        expect(work).to_have_attribute("aria-pressed", "true")
        expect(chat.get_by_role("heading", name="我们要做什么？", exact=True)).to_be_visible()
        expect(work_tip).to_be_visible()
        expect(chat.get_by_role("textbox", name="消息", exact=True)).to_be_visible()

        chat_mode = chat.get_by_role("button", name="聊天", exact=True)
        chat_mode.click()
        expect(chat_mode).to_have_attribute("aria-pressed", "true")
        expect(chat.get_by_role("heading", name="有什么可以帮你？", exact=True)).to_be_visible()
        expect(work_tip).to_be_hidden()
        expect(chat.get_by_role("button", name="选择项目", exact=True)).to_be_hidden()
        expect(toolbar.get_by_role("heading", name="开始聊天", exact=True)).to_be_visible()

    def test_home_shows_reference_conversation(self):
        page = self.open_workspace(width=1470, height=923)
        self.open_conversation(page)
        chat = page.get_by_role("main")
        expect(page.get_by_role("heading", name="安装 shotproof", exact=True)).to_have_count(1)
        expect(chat.get_by_text("安装 shotproof", exact=True).last).to_be_visible()
        expect(chat.get_by_text("Shotproof 0.4.3", exact=False).last).to_be_visible()
        expect(page.get_by_role("button", name="agent-server", exact=True)).to_be_visible()

    def test_new_chat_keeps_composer_controls_and_history(self):
        page = self.open_workspace()
        self.open_conversation(page)
        page.locator("#new-thread").click()
        expect(page.get_by_role("heading", name="开始聊天", exact=True)).to_have_count(1)

        composer = page.get_by_role("textbox", name="消息", exact=True)
        send = page.get_by_role("button", name="发送", exact=True)
        expect(send).to_be_hidden()
        message = "检查桌面与窄屏的显示效果"
        composer.fill(message)
        expect(send).to_be_visible()
        send.click()
        expect(page.get_by_text(message, exact=True).last).to_be_visible()
        expect(page.get_by_text("本地演示", exact=False).last).to_be_visible()
        expect(send).to_be_hidden()

        page.reload()
        expect(page.get_by_text(message, exact=True).last).to_be_visible()

    def test_first_reply_is_in_view_after_a_long_message(self):
        page = self.open_workspace()
        main = page.get_by_role("main")
        long_message = "\n".join(f"验收步骤 {step}" for step in range(80))
        main.get_by_role("textbox", name="消息", exact=True).fill(long_message)
        main.get_by_role("button", name="发送", exact=True).click()
        reply = main.get_by_text("本地演示：已保存这条消息。", exact=True)
        expect(reply).to_be_in_viewport(ratio=0.75, timeout=1000)

    def test_search_then_toolbar_back_reopens_previous_chat(self):
        page = self.open_workspace()
        self.open_conversation(page)
        page.get_by_role("button", name="搜索会话", exact=True).click()
        dialog = page.get_by_role("dialog")
        expect(dialog).to_be_visible()
        search = dialog.get_by_role("textbox", name="搜索会话", exact=True).or_(
            dialog.get_by_role("searchbox", name="搜索会话", exact=True)
        )
        search.fill("启动")
        dialog.get_by_role("button", name="启动项目", exact=True).click()
        expect(dialog).to_be_hidden()
        expect(page.get_by_role("heading", name="启动项目", exact=True)).to_have_count(1)

        toolbar = page.get_by_role("banner")
        toolbar.get_by_role("button", name="返回", exact=True).click()
        expect(page.get_by_role("heading", name="安装 shotproof", exact=True)).to_have_count(1)
        toolbar.get_by_role("button", name="前进", exact=True).click()
        expect(page.get_by_role("heading", name="启动项目", exact=True)).to_have_count(1)

    def test_project_disclosure_collapses_and_expands_hierarchy(self):
        page = self.open_workspace()
        project = page.get_by_role("button", name="agent-server", exact=True)
        expect(project).to_have_attribute("aria-expanded", "true")
        project.click()
        expect(project).to_have_attribute("aria-expanded", "false")
        project.click()
        expect(project).to_have_attribute("aria-expanded", "true")

    def test_mobile_navigation_drawer_does_not_overflow(self):
        page = self.open_workspace(width=375, height=812)
        expect(page.get_by_role("banner").get_by_role("heading", name="开始聊天", exact=True)).to_be_visible()
        open_navigation = page.get_by_role("button", name="显示侧边栏", exact=True)
        expect(open_navigation).to_be_visible()
        open_navigation.click()
        project = page.get_by_role("button", name="agent-server", exact=True)
        expect(project).to_be_visible()
        expect(page.get_by_role("button", name="隐藏侧边栏", exact=True)).to_be_visible()
        self.assertTrue(
            page.evaluate(
                "document.documentElement.scrollWidth <= document.documentElement.clientWidth"
            )
        )
        page.keyboard.press("Escape")
        expect(project).to_be_hidden()
        expect(open_navigation).to_be_focused()

    def test_web_rail_sections_open_in_main_and_follow_toolbar_history(self):
        page = self.open_workspace()
        rail = page.get_by_role("navigation", name="主导航", exact=True)
        main = page.get_by_role("main")
        toolbar = page.get_by_role("banner")
        for button, heading in (("资料空间", "全部"), ("定时任务", "安排任务"), ("插件", "插件")):
            with self.subTest(section=button):
                rail.get_by_role("button", name=button, exact=True).click()
                expect(main.get_by_role("heading", name=heading, exact=True)).to_be_visible(timeout=750)

        toolbar.get_by_role("button", name="返回", exact=True).click()
        expect(main.get_by_role("heading", name="安排任务", exact=True)).to_be_visible()
        toolbar.get_by_role("button", name="返回", exact=True).click()
        expect(main.get_by_role("heading", name="全部", exact=True)).to_be_visible()
        toolbar.get_by_role("button", name="前进", exact=True).click()
        expect(main.get_by_role("heading", name="安排任务", exact=True)).to_be_visible()
        toolbar.get_by_role("button", name="前进", exact=True).click()
        expect(main.get_by_role("heading", name="插件", exact=True)).to_be_visible()

    def test_explore_keeps_item_order_and_pins_sites_to_the_rail(self):
        page = self.open_workspace()
        rail = page.get_by_role("navigation", name="主导航", exact=True)
        explore = rail.get_by_role("button", name="探索", exact=True)
        sites = rail.get_by_role("button", name="站点", exact=True)
        expect(sites).to_be_visible(timeout=750)
        explore.click()
        panel = page.get_by_role("dialog", name="探索", exact=True)
        expect(panel).to_be_visible(timeout=750)
        labels = ["项目", "图像", "健康", "站点", "地图", "GPT", "Codex"]
        choices = panel.get_by_role("button", name=re.compile(f"^({'|'.join(labels)})$"))
        self.assertEqual(
            choices.evaluate_all(
                "(buttons) => buttons.map(button => button.getAttribute('aria-label') || button.textContent.trim())"
            ),
            labels,
        )
        page.keyboard.press("Escape")
        expect(panel).to_be_hidden()
        expect(explore).to_be_focused()

        explore.click()
        sites_group = panel.get_by_role("group", name="站点", exact=True)
        sites_group.get_by_role("button", name="从侧边栏取消置顶", exact=True).click()
        page.keyboard.press("Escape")
        expect(sites).to_be_hidden()
        page.reload()
        expect(sites).to_be_hidden()
        explore.click()
        sites_group.get_by_role("button", name="固定到侧边栏", exact=True).click()
        page.keyboard.press("Escape")
        expect(sites).to_be_visible()

        sites.click()
        main = page.get_by_role("main")
        expect(main.get_by_role("heading", name="全部", exact=True)).to_be_visible()
        expect(main.get_by_role("button", name="站点", exact=True)).to_have_attribute("aria-pressed", "true")

    def test_home_sidebar_exposes_reference_option_menus(self):
        page = self.open_workspace()
        sidebar = page.get_by_role("complementary", name="项目和聊天", exact=True)
        cases = (
            ("项目", "项目侧边栏选项", ("整理侧边栏", "聊天排序方式")),
            ("最近", "聊天侧边栏选项", ("整理侧边栏", "排序方式", "显示")),
        )
        for section, name, items in cases:
            region = sidebar.get_by_role("region", name=section, exact=True)
            region.get_by_role("heading", name=section, exact=True).hover()
            trigger = region.get_by_role("button", name=name, exact=True)
            trigger.click(timeout=750)
            menu = page.get_by_role("menu")
            for item in items:
                expect(menu.get_by_role("menuitem", name=item, exact=True)).to_be_visible()
            page.keyboard.press("Escape")
            expect(menu).to_be_hidden()
            expect(trigger).to_be_focused()

    def test_schedule_filter_exposes_the_three_task_statuses(self):
        page = self.open_workspace()
        rail = page.get_by_role("navigation", name="主导航", exact=True)
        rail.get_by_role("button", name="定时任务", exact=True).click()
        trigger = page.get_by_role("button", name="筛选任务", exact=True)
        trigger.click(timeout=750)
        menu = page.get_by_role("menu")
        labels = ("已开启", "已暂停", "已完成")
        for label in labels:
            expect(menu.get_by_role("menuitemcheckbox", name=label, exact=True)).to_be_visible()
        page.keyboard.press("Escape")
        expect(menu).to_be_hidden()
        expect(trigger).to_be_focused()

    def test_library_create_menu_matches_reference_order(self):
        page = self.open_workspace()
        rail = page.get_by_role("navigation", name="主导航", exact=True)
        rail.get_by_role("button", name="资料空间", exact=True).click()
        trigger = page.get_by_role("main").get_by_role("button", name="创建", exact=True)
        trigger.click(timeout=750)
        menu = page.get_by_role("menu")
        items = menu.get_by_role("menuitem")
        labels = (
            "从模板开始", "页面", "幻灯片", "电子表格", "站台", "图像",
            "文件夹", "资料空间", "上传文件", "连接插件",
        )
        expect(items).to_have_count(len(labels), timeout=750)
        for index, label in enumerate(labels):
            item = items.nth(index)
            if label == "电子表格":
                expect(item).to_have_accessible_name(re.compile(f"^{label}"))
                expect(item).to_be_disabled()
            else:
                expect(item).to_have_accessible_name(label)

        menu.get_by_role("menuitem", name="页面", exact=True).click()
        dialog = page.get_by_role("dialog", name="创建页面", exact=True)
        expect(dialog.get_by_role("textbox", name="名称", exact=True)).to_be_visible()

    def test_plugin_add_exposes_the_three_creation_paths(self):
        page = self.open_workspace()
        rail = page.get_by_role("navigation", name="主导航", exact=True)
        rail.get_by_role("button", name="插件", exact=True).click()
        trigger = page.get_by_role("main").get_by_role("button", name="添加", exact=True)
        trigger.click(timeout=750)
        menu = page.get_by_role("menu")
        for label in ("创建插件", "上传插件压缩包", "添加自定义 MCP 服务器"):
            expect(menu.get_by_role("menuitem", name=label, exact=True)).to_be_visible()
        page.keyboard.press("Escape")
        expect(menu).to_be_hidden()
        expect(trigger).to_be_focused()

    def test_toolbar_and_composer_menu_triggers_are_accessible(self):
        page = self.open_workspace()
        self.open_conversation(page)
        for label in ("添加附件", "模型"):
            with self.subTest(label=label):
                expect(page.get_by_role("button", name=label, exact=True)).to_be_visible()
        toolbar = page.get_by_role("banner")
        toolbar.get_by_role("button", name="更多", exact=True).click()
        expect(page.get_by_role("menu").get_by_role("menuitem", name="重命名")).to_be_visible()

    def test_toolbar_icons_show_chinese_tooltips_on_hover(self):
        page = self.open_workspace()
        toolbar = page.get_by_role("banner")

        def expect_tooltip(label):
            control = toolbar.get_by_role("button", name=label, exact=True)
            expect(control).to_be_visible(timeout=500)
            item = control.locator("xpath=..")
            expect(item).to_have_class("toolbar-item", timeout=500)
            item.hover()
            self.assertEqual(
                item.evaluate(
                    """node => {
                        const tooltip = getComputedStyle(node, "::after");
                        return [tooltip.content, tooltip.visibility];
                    }"""
                ),
                [f'"{label}"', "visible"],
            )

        labels = ("返回", "前进", "隐藏侧边栏", "更多", "摘要", "标签页")
        for label in labels:
            with self.subTest(label=label):
                expect_tooltip(label)

        toolbar.get_by_role("button", name="隐藏侧边栏", exact=True).click()
        expect_tooltip("显示侧边栏")
        expect_tooltip("新聊天")

    def test_toolbar_summary_uses_current_conversation(self):
        page = self.open_workspace()
        self.open_conversation(page)
        toolbar = page.get_by_role("banner")
        summary = toolbar.get_by_role("button", name="摘要", exact=True)
        summary.click()
        dialog = page.get_by_role("dialog", name="摘要", exact=True)
        expect(dialog.get_by_text("安装 shotproof", exact=True).first).to_be_visible()
        expect(dialog.get_by_text("已在 Codex", exact=False)).to_be_visible()
        dialog.get_by_role("button", name="关闭", exact=True).click()
        expect(summary).to_be_focused()

        self.open_conversation(page, "启动项目")
        summary.click()
        expect(dialog.get_by_text("启动项目", exact=True).first).to_be_visible()
        expect(dialog.get_by_text("已在 Codex", exact=False)).to_have_count(0)

    def test_suggestion_and_permission_controls_change_local_composer(self):
        page = self.open_workspace()
        self.open_conversation(page)
        composer = page.get_by_role("textbox", name="消息", exact=True)
        composer.focus()
        page.keyboard.press("Tab")
        expect(composer).to_have_value("用 Shotproof 把这张截图转成 HTML，并验证还原效果。")
        attachments = page.get_by_role("button", name="添加附件", exact=True)
        permissions = page.get_by_role("menuitem", name="权限", exact=True)
        default_permission = page.get_by_role("menuitemradio", name="默认权限", exact=True)
        attachments.click()
        permissions.click()
        default_permission.click()
        expect(page.get_by_text("权限已切换为默认权限", exact=True)).to_be_visible()
        page.reload()
        attachments.click()
        permissions.click()
        expect(default_permission).to_have_attribute("aria-checked", "true")

    def test_work_suggestion_adds_a_draft_without_sending(self):
        page = self.open_workspace()
        main = page.get_by_role("main")
        composer = main.get_by_role("textbox", name="消息", exact=True)
        main.get_by_role("button", name="整理项目结构").click()
        expect(composer).not_to_have_value("")
        expect(composer).to_be_focused()
        expect(main.get_by_role("button", name="发送", exact=True)).to_be_visible()
        expect(page.get_by_role("banner").get_by_role("heading", name="开始聊天", exact=True)).to_be_visible()

    def test_selecting_a_work_project_retains_the_draft(self):
        page = self.open_workspace()
        main = page.get_by_role("main")
        draft = "检查选中项目的目录"
        composer = main.get_by_role("textbox", name="消息", exact=True)
        composer.fill(draft)
        main.get_by_role("button", name="选择项目", exact=True).click()
        page.get_by_role("menuitemradio", name="dsh-poc", exact=True).click()
        expect(main.get_by_role("button", name="dsh-poc", exact=True)).to_be_visible()
        expect(composer).to_have_value(draft)
        expect(composer).to_be_focused()
        main.get_by_role("button", name="发送", exact=True).click()
        expect(main.get_by_text(draft, exact=True)).to_be_visible()
        page.get_by_role("banner").get_by_role("button", name="标签页", exact=True).click()
        details = page.get_by_role("complementary", name="标签页")
        expect(details.get_by_text("dsh-poc", exact=True)).to_be_visible()

    def test_temporary_chat_is_excluded_from_history_and_reload(self):
        page = self.open_workspace()
        self.open_conversation(page)
        toolbar = page.get_by_role("banner")
        main = page.get_by_role("main")
        temporary = main.get_by_role("button", name="临时聊天", exact=True)
        temporary.click()
        expect(temporary).to_have_attribute("aria-pressed", "true")
        expect(toolbar.get_by_role("heading", name="临时聊天", exact=True)).to_be_visible()

        marker = "仅用于临时聊天的验证消息"
        main.get_by_role("textbox", name="消息", exact=True).fill(marker)
        main.get_by_role("button", name="发送", exact=True).click()
        expect(main.get_by_text(marker, exact=True)).to_be_visible()
        expect(page.get_by_role("region", name="最近", exact=True)).not_to_contain_text(marker)

        temporary.click()
        expect(temporary).to_have_attribute("aria-pressed", "false")
        expect(toolbar.get_by_role("heading", name="安装 shotproof", exact=True)).to_be_visible()
        expect(main.get_by_text(marker, exact=True)).to_have_count(0)
        page.reload()
        expect(temporary).to_have_attribute("aria-pressed", "false")
        expect(toolbar.get_by_role("heading", name="安装 shotproof", exact=True)).to_be_visible()
        expect(page.get_by_text(marker, exact=True)).to_have_count(0)

    def test_sidebar_toggle_and_right_pane_share_one_row(self):
        page = self.open_workspace(width=1470, height=923)
        page.get_by_role("button", name="隐藏侧边栏", exact=True).click()
        page.get_by_role("button", name="标签页", exact=True).click()
        content = page.get_by_role("main").bounding_box()
        details = page.get_by_role("complementary", name="标签页").bounding_box()
        self.assertEqual(content["y"], details["y"])
        self.assertGreater(content["width"], details["width"])
        self.assertAlmostEqual(content["x"] + content["width"], details["x"], delta=1)
        page.get_by_role("button", name="关闭标签页", exact=True).click()

        page.set_viewport_size({"width": 630, "height": 810})
        page.get_by_role("button", name="显示侧边栏", exact=True).click()
        expect(page.get_by_role("button", name="agent-server", exact=True)).to_be_visible()
        page.get_by_role("button", name="关闭导航", exact=True).click(position={"x": 520, "y": 250})
        expect(page.get_by_role("button", name="agent-server", exact=True)).to_be_hidden()

    def test_toolbar_history_aligns_to_the_right_edge_of_the_sidebar(self):
        page = self.open_workspace(width=1470, height=923)
        toggle = page.get_by_role("button", name="隐藏侧边栏", exact=True)
        back = page.get_by_role("button", name="返回", exact=True).bounding_box()
        forward = page.get_by_role("button", name="前进", exact=True).bounding_box()
        sidebar = page.get_by_role("complementary", name="项目和聊天").bounding_box()
        self.assertLess(toggle.bounding_box()["x"], sidebar["x"])
        self.assertGreaterEqual(back["x"], sidebar["x"])
        self.assertAlmostEqual(back["x"] + back["width"], forward["x"], delta=1)
        self.assertAlmostEqual(
            forward["x"] + forward["width"], sidebar["x"] + sidebar["width"], delta=1
        )

        toggle.click()
        forward = page.get_by_role("button", name="前进", exact=True).bounding_box()
        title = page.locator(".toolbar-title").bounding_box()
        self.assertLessEqual(forward["x"] + forward["width"], title["x"])

    def test_toolbar_new_chat_is_available_only_when_the_sidebar_is_hidden(self):
        for width in (1470, 375):
            with self.subTest(width=width):
                page = self.open_workspace(width=width)
                toolbar = page.get_by_role("banner")
                new_chat = toolbar.get_by_role("button", name="新聊天", exact=True)
                if width == 375:
                    expect(new_chat).to_be_visible()
                    toolbar.get_by_role("button", name="显示侧边栏", exact=True).click()
                expect(new_chat).to_be_hidden()
                expect(page.locator("#new-thread")).to_be_visible()

                toolbar.get_by_role("button", name="隐藏侧边栏", exact=True).click()
                expect(new_chat).to_be_visible()
                forward = toolbar.get_by_role("button", name="前进", exact=True).bounding_box()
                editor = new_chat.bounding_box()
                title = toolbar.locator(".toolbar-title").bounding_box()
                self.assertAlmostEqual(forward["x"] + forward["width"], editor["x"], delta=1)
                self.assertLessEqual(editor["x"] + editor["width"], title["x"])

                new_chat.click()
                expect(toolbar.get_by_role("heading", name="开始聊天", exact=True)).to_be_visible()
                expect(page.get_by_role("textbox", name="消息", exact=True)).to_be_focused()

    def test_moving_an_active_chat_keeps_both_tabs_on_valid_data(self):
        page = self.open_workspace()
        other = page.context.new_page()
        other.goto(self.url)
        for tab in (page, other):
            tab.get_by_role("region", name="最近").get_by_role(
                "button", name="安装 shotproof", exact=True
            ).click()
            expect(tab.get_by_role("banner").get_by_role("heading")).to_have_text("安装 shotproof")

        recent = page.get_by_role("region", name="最近")
        row = recent.get_by_role("button", name="安装 shotproof", exact=True).locator("..")
        row.get_by_role("button", name="聊天操作").press("Enter")
        page.get_by_role("menuitem", name="移至项目", exact=True).press("ArrowRight")
        page.get_by_role("menu", name="移至项目").get_by_role("menuitem", name="dsh-poc").click()
        page.wait_for_function(
            """() => JSON.parse(localStorage.getItem('codex-desktop-replica-v1'))?.projectId === 'dsh-poc'"""
        )
        other.get_by_role("button", name="聊天", exact=True).click()
        expect(other.get_by_role("button", name="聊天", exact=True)).to_have_attribute("aria-pressed", "true")
        other.reload()
        expect(other.get_by_role("banner").get_by_role("heading")).to_have_text("安装 shotproof")
        expect(other.get_by_role("log", name="消息记录")).to_contain_text("Shotproof 0.4.3")

    def test_new_chat_uses_a_visible_project_after_selected_project_is_removed(self):
        page = self.open_workspace()
        picker = page.locator("#work-project")
        picker.click()
        page.get_by_role("menuitemradio", name="dsh-poc", exact=True).click()
        expect(picker).to_have_text("dsh-poc")
        page.get_by_role("button", name="dsh-poc 的项目操作").press("Enter")
        page.get_by_role("menuitem", name="删除项目", exact=True).click()
        dialog = page.get_by_role("dialog", name="删除项目", exact=True)
        dialog.get_by_role("button", name="删除", exact=True).click()
        expect(dialog).to_be_hidden()
        expect(picker).to_have_text("选择项目")

        page.get_by_role("textbox", name="消息", exact=True).fill("验证新项目归属")
        page.get_by_role("button", name="发送", exact=True).click()
        page.wait_for_function(
            """() => {
                const saved = JSON.parse(localStorage.getItem('codex-desktop-replica-v1'));
                const chat = saved?.threads.find(({title}) => title === '验证新项目归属');
                return chat && !saved.projects.find(({id}) => id === chat.projectId).hidden;
            }"""
        )

    def test_two_tabs_preserve_both_sends(self):
        page = self.open_workspace()
        self.open_conversation(page)
        second = page.context.new_page()
        second.goto(self.url)
        self.open_conversation(second)
        for tab, text in ((page, "第一标签页的任务"), (second, "第二标签页的任务")):
            tab.get_by_role("textbox", name="消息", exact=True).fill(text)
        for tab, text in ((page, "第一标签页的任务"), (second, "第二标签页的任务")):
            tab.get_by_role("button", name="发送", exact=True).click()
            expect(tab.get_by_role("main").get_by_text(text, exact=True).last).to_be_visible()
        page.reload()
        expect(page.get_by_text("第一标签页的任务", exact=True).last).to_be_visible()
        expect(page.get_by_text("第二标签页的任务", exact=True).last).to_be_visible()


if __name__ == "__main__":
    unittest.main()
