// SPDX-License-Identifier: GPL-3.0-only
#include "connection.h"
#include <algorithm>
#include <chrono>
#include <csignal>
#include <fcntl.h>
#include <iostream>
#include <stdexcept>
#include <sys/wait.h>
#include <thread>
using namespace hw;
namespace {
const char* socket_path() {
#ifdef HARDWARE_UI_TESTING
    const char* p=getenv("HARDWARE_UI_TEST_SOCKET"); if (p && *p) return p;
#endif
    return "/var/run/lotus-hardware/control.sock";
}
Value call(Connection& c,const std::string& method,Value params=object({})) {
    Value reply; std::string error;
    if (!c.request(method,params,&reply,&error,1000)) throw std::runtime_error(error);
    if (field(reply,"ok")!=Value(true)) throw std::runtime_error(
        field(field(reply,"error"),"code").is<std::string>()?
        field(field(reply,"error"),"code").get<std::string>():"service_error");
    return field(reply,"result");
}
void connect(Connection& c) {
    std::string error; if (!c.connect_to(socket_path(),&error)) throw std::runtime_error("service_unavailable");
}
// Fixed executable/argument vectors only. Child output and lifetime are bounded.
std::pair<int,std::string> run(const char* executable,const char* argument,const char* second=nullptr,
    const char* third=nullptr,const char* fourth=nullptr) {
#ifdef HARDWARE_UI_TESTING
    (void)executable; (void)argument; (void)second; (void)third; (void)fourth; return {1,""};
#else
    int pipefd[2]; if (pipe2(pipefd,O_CLOEXEC)) throw std::runtime_error("pipe_failed");
    pid_t child=fork();
    if (child<0) { close(pipefd[0]); close(pipefd[1]); throw std::runtime_error("fork_failed"); }
    if (!child) {
        setpgid(0,0); dup2(pipefd[1],STDOUT_FILENO);
        int null=open("/dev/null",O_RDWR); if (null>=0) { dup2(null,STDIN_FILENO); dup2(null,STDERR_FILENO); }
        close(pipefd[0]); close(pipefd[1]); execl(executable,executable,argument,second,third,fourth,nullptr); _exit(127);
    }
    close(pipefd[1]); setpgid(child,child); fcntl(pipefd[0],F_SETFL,O_NONBLOCK);
    std::string out; int status=0;
    const auto end=std::chrono::steady_clock::now()+std::chrono::seconds(4);
    for (;;) {
        char buffer[4096]; ssize_t n;
        while ((n=read(pipefd[0],buffer,sizeof(buffer)))>0) {
            if (out.size()+static_cast<size_t>(n)>65536) {
                kill(-child,SIGKILL); waitpid(child,&status,0); close(pipefd[0]);
                throw std::runtime_error("command_output_limit");
            }
            out.append(buffer,static_cast<size_t>(n));
        }
        const auto result=waitpid(child,&status,WNOHANG);
        if (result==child) break;
        if (result<0 || std::chrono::steady_clock::now()>=end) {
            kill(-child,SIGKILL); waitpid(child,&status,0); close(pipefd[0]);
            throw std::runtime_error("command_timeout");
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
    close(pipefd[0]); return {WIFEXITED(status)?WEXITSTATUS(status):1,out};
#endif
}
Value status() {
    Object result{{"running",Value(false)},{"autostart",Value(run("/etc/init.d/lotus_hardware","enabled").first==0)}};
    try {
        Connection c; connect(c); result["state"]=call(c,"state.get");
        result["capabilities"]=call(c,"capabilities.get"); result["running"]=Value(true);
    } catch (const std::exception& e) { result["error"]=str(e.what()); }
    return object(std::move(result));
}
void require(bool ok) { if (!ok) throw std::runtime_error("invalid_request"); }
Value dispatch(const std::string& method,const Value& p) {
    require(p.is<Object>());
    if (method=="status") { require(p.get<Object>().empty()); return status(); }
    if (method=="logs") {
        require(p.get<Object>().empty());
        auto output=run("/sbin/logread","-e","lotus-hardwared","-l","80");
        if (output.first) throw std::runtime_error("log_unavailable");
        unsigned lines=0; size_t start=output.second.size();
        while (start && lines<81) if (output.second[--start]=='\n') ++lines;
        if (lines==81) output.second.erase(0,start+1);
        return object({{"text",str(output.second)}});
    }
    if (method=="service") {
        require(p.get<Object>().size()==1 && field(p,"action").is<std::string>());
        const auto action=field(p,"action").get<std::string>();
        require(action=="start" || action=="stop" || action=="restart" || action=="enable" || action=="disable");
        if (action=="stop" || action=="restart") {
            try { Connection c; connect(c); const auto s=call(c,"state.get");
                if (field(s,"owner_connection")!=num(0)) throw std::runtime_error("resource_busy_stop_application_first");
            } catch (const std::runtime_error& e) {
                if (std::string(e.what())!="service_unavailable") throw;
            }
        }
        const auto result=run("/etc/init.d/lotus_hardware",action.c_str());
        if (result.first) throw std::runtime_error("service_command_failed");
        if (action=="start" || action=="restart") {
            for (unsigned i=0;i<10;++i) {
                if (field(status(),"running")==Value(true)) return object({{"done",Value(true)}});
                std::this_thread::sleep_for(std::chrono::milliseconds(100));
            }
            throw std::runtime_error("startup_failed_check_configuration_and_log");
        }
        return object({{"done",Value(true)}});
    }
    Connection c; connect(c);
    if (method=="set_volume") {
        require(p.get<Object>().size()==1 && integer(field(p,"percent"),0,100));
        return call(c,"volume.set",p);
    }
    if (method=="adjust_volume") {
        require(p.get<Object>().size()==1 && (field(p,"delta")==num(5) || field(p,"delta")==num(-5)));
        return call(c,"volume.adjust",p);
    }
    if (method=="set_privacy") {
        require(p.get<Object>().size()==1 && field(p,"muted").is<bool>());
        return call(c,"privacy.set",p);
    }
    if (method=="test_led") {
        require(p.get<Object>().size()==1 && field(p,"effect").is<std::string>());
        const auto effect=field(p,"effect").get<std::string>();
        require(effect=="solid" || effect=="breath" || effect=="gradient");
        call(c,"lease.acquire",object({{"ttl_ms",num(5000)}}));
        Object led{{"effect",str(effect)},{"color",num(effect=="solid"?0xffffff:0x0000ff)},
            {"brightness_percent",num(20)},{"duration_ms",num(2000)}};
        if (effect!="solid") led["period_ms"]=num(2000);
        if (effect=="gradient") led["color_2"]=num(0x00ffff);
        call(c,"led.set",object(led));
        std::this_thread::sleep_for(std::chrono::milliseconds(2100));
        call(c,"lease.release"); return object({{"done",Value(true)}});
    }
    throw std::runtime_error("unknown_method");
}
}
int main(int argc,char** argv) {
    if (argc==2 && std::string(argv[1])=="list") {
        std::cout<<"{\"status\":{},\"logs\":{},\"set_volume\":{\"percent\":0},\"adjust_volume\":{\"delta\":0},\"set_privacy\":{\"muted\":true},\"service\":{\"action\":\"\"},\"test_led\":{\"effect\":\"\"}}\n"; return 0;
    }
    if (argc!=3 || std::string(argv[1])!="call") return 2;
    Value response;
    try {
        std::string body; char buffer[1024]; ssize_t n;
        while ((n=read(STDIN_FILENO,buffer,sizeof(buffer)))>0) {
            body.append(buffer,static_cast<size_t>(n)); require(body.size()<=16384);
        }
        require(n==0);
        while (!body.empty() && (body.back()=='\n' || body.back()=='\r')) body.pop_back();
        Value request; require(hw::parse(request,body.empty()?"{}":body));
        require(request.is<Object>());
        // HTTP ubus adds transport session metadata; authorization is handled
        // by ubus/rpcd ACLs, never by treating this field as a credential here.
        auto& params=request.get<Object>();
        auto session=params.find("ubus_rpc_session");
        if (session!=params.end()) {
            require(session->second.is<std::string>());
            const auto& id=session->second.get<std::string>();
            require(id.size()==32 && std::all_of(id.begin(),id.end(),[](char c) {
                return (c>='0' && c<='9') || (c>='a' && c<='f');
            }));
            params.erase(session);
        }
        response=object({{"ok",Value(true)},{"result",dispatch(argv[2],request)}});
    } catch (const std::exception& e) { response=object({{"ok",Value(false)},{"error",str(e.what())}}); }
    std::cout<<response.serialize()<<'\n'; return 0;
}
